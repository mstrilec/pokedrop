import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
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
import { TRADE_SELECT, TradeCloseService, type TradeRow } from '../trades/index.js';

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
    private readonly closer: TradeCloseService,
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

  /**
   * Trades are closed before `users` is touched: an accept takes the trade's
   * row and then the user rows, and taking them in the same order here makes
   * the two queue instead of deadlocking.
   */
  async suspend(admin: AuthUser, id: string, reason: string): Promise<AdminUserRow> {
    this.assertNotSelf(admin, id);

    let voided: TradeRow[] = [];
    try {
      voided = await this.prisma.withTransaction(async (tx) => {
        const target = await this.target(tx, id);
        if (target.suspendedAt !== null) {
          throw new Unchanged();
        }

        const pending = await tx.trade.findMany({
          where: { status: 'PENDING', OR: [{ initiatorId: id }, { recipientId: id }] },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: TRADE_SELECT,
        });
        const closed: TradeRow[] = [];
        for (const trade of pending) {
          try {
            await this.closer.close(tx, trade, {
              to: 'VOIDED',
              action: 'trade.void',
              actorId: admin.id,
              release: true,
              meta: { reason: 'account suspended' },
            });
            closed.push(trade);
          } catch (error) {
            if (codeOf(error) !== ERROR_CODES.TRADE_NOT_PENDING) {
              throw error;
            }
          }
        }

        if (target.role === 'ADMIN') {
          await this.assertNotLastAdmin(tx, id);
        }
        const { count } = await tx.user.updateMany({
          where: { id, suspendedAt: null },
          data: { suspendedAt: new Date() },
        });
        if (count === 0) {
          throw new Unchanged();
        }
        await tx.session.deleteMany({ where: { userId: id } });
        await this.audit.record(tx, {
          actorId: admin.id,
          action: 'user.suspend',
          entity: 'User',
          entityId: id,
          meta: { reason, voidedTradeIds: closed.map((trade) => trade.id) },
        });
        return closed;
      });
    } catch (error) {
      if (!(error instanceof Unchanged)) {
        throw error;
      }
    }

    await this.notifications.notify(
      voided.flatMap((trade) =>
        [trade.initiatorId, trade.recipientId].map((userId) => ({
          userId,
          type: 'trade.voided' as const,
          payload: { tradeId: trade.id },
        })),
      ),
    );
    return this.row(id);
  }

  async unsuspend(admin: AuthUser, id: string): Promise<AdminUserRow> {
    this.assertNotSelf(admin, id);

    await this.prisma.withTransaction(async (tx) => {
      await this.target(tx, id);
      const { count } = await tx.user.updateMany({
        where: { id, suspendedAt: { not: null } },
        data: { suspendedAt: null },
      });
      if (count === 0) {
        return;
      }
      await this.audit.record(tx, {
        actorId: admin.id,
        action: 'user.unsuspend',
        entity: 'User',
        entityId: id,
        meta: {},
      });
    });

    return this.row(id);
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

/** Thrown to roll back a suspension that finds the account already suspended. */
class Unchanged extends Error {}

function codeOf(error: unknown): unknown {
  if (!(error instanceof HttpException)) {
    return undefined;
  }
  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'code' in response
    ? response.code
    : undefined;
}
