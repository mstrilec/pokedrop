import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Role } from '@prisma/client';
import {
  AdminUserPageSchema,
  AdminUserRowSchema,
  ERROR_CODES,
  GrantResultSchema,
  type AdminUserListQuery,
  type AdminUserPage,
  type AdminUserRow,
  type GrantCurrency,
  type GrantResult,
} from '@pokedrop/shared';
import { AuditService } from '../audit/index.js';
import { domainError } from '../common/errors/domain-error.js';
import { isUniqueViolation } from '../common/errors/prisma-error.js';
import type { AuthUser } from '../common/request-auth.js';
import { NotificationsService } from '../notifications/index.js';
import { PrismaService, type TransactionClient } from '../prisma/index.js';

const ROW_SELECT = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  currency: true,
  emailVerified: true,
  suspendedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: AdminUserListQuery): Promise<AdminUserPage> {
    const q = query.q === undefined ? undefined : escapeLike(query.q);
    const where: Prisma.UserWhereInput = {
      ...(q === undefined
        ? {}
        : {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { displayName: { contains: q, mode: 'insensitive' } },
            ],
          }),
      ...(query.role === undefined ? {} : { role: query.role }),
      ...(query.suspended === undefined
        ? {}
        : { suspendedAt: query.suspended ? { not: null } : null }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: ROW_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);

    return AdminUserPageSchema.parse({
      items: rows,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    });
  }

  async changeRole(admin: AuthUser, id: string, role: Role): Promise<AdminUserRow> {
    this.assertNotSelf(admin, id);

    await this.prisma.withTransaction(async (tx) => {
      const target = await this.target(tx, id);
      if (target.role === role) {
        return;
      }
      if (target.role === 'ADMIN' && target.suspendedAt === null) {
        await this.assertNotLastAdmin(tx, id);
      }
      await tx.user.update({ where: { id }, data: { role } });
      await this.audit.record(tx, {
        actorId: admin.id,
        action: 'user.role_change',
        entity: 'User',
        entityId: id,
        meta: { from: target.role, to: role },
      });
    });

    return this.row(id);
  }

  /**
   * The ledger row is the first write, keyed by grantId, so a replay stops on
   * the unique index before it can touch the balance.
   */
  async grant(admin: AuthUser, id: string, body: GrantCurrency): Promise<GrantResult> {
    let result: GrantResult;
    try {
      result = await this.prisma.withTransaction(async (tx) => {
        await this.target(tx, id);
        const entry = await tx.currencyTransaction.create({
          data: { userId: id, amount: body.amount, type: 'GRANT', refId: body.grantId },
          select: { id: true, amount: true, createdAt: true },
        });
        const updated = await tx.$queryRaw<{ currency: number }[]>`
          UPDATE users SET currency = currency + ${body.amount}
          WHERE id = ${id} AND currency + ${body.amount} >= 0
          RETURNING currency`;
        const balance = updated[0]?.currency;
        if (balance === undefined) {
          throw domainError(
            HttpStatus.CONFLICT,
            ERROR_CODES.INSUFFICIENT_FUNDS,
            'This would take the balance below zero',
          );
        }
        await this.audit.record(tx, {
          actorId: admin.id,
          action: 'user.currency_grant',
          entity: 'User',
          entityId: id,
          meta: { grantId: body.grantId, amount: body.amount, reason: body.reason },
        });
        return GrantResultSchema.parse({ userId: id, balance, transaction: entry });
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.replayGrant(id, body);
    }

    await this.notifications.notify([
      { userId: id, type: 'currency.granted', payload: { amount: body.amount } },
    ]);
    return result;
  }

  private async replayGrant(id: string, body: GrantCurrency): Promise<GrantResult> {
    const entry = await this.prisma.currencyTransaction.findFirstOrThrow({
      where: { userId: id, type: 'GRANT', refId: body.grantId },
      select: { id: true, amount: true, createdAt: true },
    });
    if (entry.amount !== body.amount) {
      throw domainError(
        HttpStatus.CONFLICT,
        ERROR_CODES.GRANT_ID_CONFLICT,
        'This grantId was already used for a different amount',
      );
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: { currency: true },
    });
    return GrantResultSchema.parse({ userId: id, balance: user.currency, transaction: entry });
  }

  private assertNotSelf(admin: AuthUser, id: string): void {
    if (admin.id === id) {
      throw domainError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.SELF_TARGET,
        'An admin cannot do this to their own account',
      );
    }
  }

  private async target(tx: TransactionClient, id: string) {
    const target = await tx.user.findUnique({
      where: { id },
      select: { id: true, role: true, suspendedAt: true },
    });
    if (target === null) {
      throw new NotFoundException('User not found');
    }
    return target;
  }

  /**
   * Locks every active admin in id order before counting them. A concurrent
   * change waits here, and once the first commits PostgreSQL re-checks the
   * waiting rows against the WHERE, so it counts what is really left.
   */
  private async assertNotLastAdmin(tx: TransactionClient, targetId: string): Promise<void> {
    const admins = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
      WHERE role = 'ADMIN' AND "suspendedAt" IS NULL
      ORDER BY id
      FOR UPDATE`;
    if (admins.length <= 1 && admins.some((admin) => admin.id === targetId)) {
      throw domainError(
        HttpStatus.CONFLICT,
        ERROR_CODES.LAST_ADMIN,
        'This would leave no active admin',
      );
    }
  }

  private async row(id: string): Promise<AdminUserRow> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: ROW_SELECT });
    return AdminUserRowSchema.parse(row);
  }
}

/**
 * Prisma passes `contains` to ILIKE unescaped: measured, `_` matched every
 * user and `pokedrop_test` matched `pokedrop.test`. Backslash is ILIKE's
 * default escape character.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
