import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ERROR_CODES,
  MAX_COUNTER_CHAIN,
  type CounterTrade,
  type ProposeTrade,
  type Trade,
  type TradeLine,
  type TradeNotificationType,
  type VoidCheck,
} from '@pokedrop/shared';
import { AuditService } from '../audit/index.js';
import { domainError } from '../common/errors/domain-error.js';
import type { AuthUser } from '../common/request-auth.js';
import { InventoryService } from '../inventory/index.js';
import { NotificationsService } from '../notifications/index.js';
import { PrismaService, type TransactionClient } from '../prisma/index.js';
import { TradeCloseService } from './trade-close.service.js';
import { TRADE_SELECT, offeredChanges, toTrade, tradeLines, type TradeRow } from './trade-row.js';
import { TradeSettlementService } from './trade-settlement.service.js';

type Terms = { offered: TradeLine[]; requested: TradeLine[]; currencyFromInitiator: number };

type Role = 'initiator' | 'recipient';

/** Thrown at the end of a void check so its transaction rolls back whatever it did. */
class DryRun extends Error {}

/** The trade is visible to both parties, so the wrong one gets an honest 403. */
function assertRole(trade: TradeRow, user: AuthUser, role: Role): void {
  const allowed = role === 'initiator' ? trade.initiatorId : trade.recipientId;
  if (allowed !== user.id) {
    throw new ForbiddenException(`Only the ${role} can do this`);
  }
}

function counterparty(trade: TradeRow, userId: string): string {
  return trade.initiatorId === userId ? trade.recipientId : trade.initiatorId;
}

@Injectable()
export class TradesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly closer: TradeCloseService,
    private readonly settlement: TradeSettlementService,
  ) {}

  async propose(user: AuthUser, input: ProposeTrade): Promise<Trade> {
    if (input.recipientId === user.id) {
      throw new BadRequestException('You cannot trade with yourself');
    }
    const recipient = await this.prisma.user.findUnique({
      where: { id: input.recipientId },
      select: { id: true, suspendedAt: true },
    });
    // A suspended account cannot answer: the offer would only lock the caller's cards until it
    // expired. The same 404 as an unknown id, as the member search leaves them out too.
    if (recipient === null || recipient.suspendedAt !== null) {
      throw new NotFoundException('User not found');
    }
    await this.assertTerms(user.id, input);

    const row = await this.prisma.withTransaction(async (tx) => {
      const created = await tx.trade.create({
        data: {
          initiatorId: user.id,
          recipientId: input.recipientId,
          currencyFromInitiator: input.currencyFromInitiator,
          currencyFromRecipient: input.currencyFromRecipient,
          items: { createMany: { data: tradeLines(input) } },
        },
        select: TRADE_SELECT,
      });
      await this.inventory.lock(tx, user.id, input.offered);
      await this.audit.record(tx, {
        actorId: user.id,
        action: 'trade.propose',
        entity: 'Trade',
        entityId: created.id,
        meta: { from: null, to: 'PENDING', counteredTradeId: null },
      });
      return created;
    });

    await this.notify([row.recipientId], 'trade.proposed', row.id);
    return toTrade(row);
  }

  decline(user: AuthUser, id: string): Promise<Trade> {
    return this.finish(user, id, {
      role: 'recipient',
      to: 'DECLINED',
      action: 'trade.decline',
      notify: 'trade.declined',
    });
  }

  cancel(user: AuthUser, id: string): Promise<Trade> {
    return this.finish(user, id, {
      role: 'initiator',
      to: 'CANCELLED',
      action: 'trade.cancel',
      notify: 'trade.cancelled',
    });
  }

  async accept(user: AuthUser, id: string): Promise<Trade> {
    const trade = await this.loadAsParty(user, id);
    assertRole(trade, user, 'recipient');

    await this.prisma.withTransaction(async (tx) => {
      await this.closer.close(tx, trade, {
        to: 'ACCEPTED',
        action: 'trade.accept',
        actorId: user.id,
        release: false,
      });
      await this.settlement.settle(tx, trade);
    });

    await Promise.all([
      this.inventory.invalidateSummary(trade.initiatorId),
      this.inventory.invalidateSummary(trade.recipientId),
    ]);
    await this.notify([trade.initiatorId], 'trade.accepted', trade.id);
    return this.read(id);
  }

  async counter(user: AuthUser, id: string, input: CounterTrade): Promise<Trade> {
    const original = await this.loadAsParty(user, id);
    assertRole(original, user, 'recipient');
    await this.assertTerms(user.id, input);

    const row = await this.prisma.withTransaction(async (tx) => {
      await this.closer.close(tx, original, {
        to: 'COUNTERED',
        action: 'trade.counter',
        actorId: user.id,
        release: false,
      });

      const [chain] = await tx.$queryRaw<{ length: number }[]>`
        WITH RECURSIVE chain AS (
          SELECT id, "counteredTradeId" FROM trades WHERE id = ${original.id}
          UNION ALL
          SELECT t.id, t."counteredTradeId" FROM trades t JOIN chain c ON t.id = c."counteredTradeId"
        )
        SELECT COUNT(*)::int AS length FROM chain`;
      if ((chain?.length ?? 0) >= MAX_COUNTER_CHAIN) {
        throw domainError(
          HttpStatus.CONFLICT,
          ERROR_CODES.COUNTER_LIMIT,
          `A negotiation stops at ${MAX_COUNTER_CHAIN} trades`,
        );
      }

      const created = await tx.trade.create({
        data: {
          initiatorId: user.id,
          recipientId: original.initiatorId,
          currencyFromInitiator: input.currencyFromInitiator,
          currencyFromRecipient: input.currencyFromRecipient,
          counteredTradeId: original.id,
          items: { createMany: { data: tradeLines(input) } },
        },
        select: TRADE_SELECT,
      });

      // Two users' rows in one transaction go in ascending userId, like every
      // other writer, not release-then-lock - the other order can deadlock.
      const release = () =>
        this.inventory.release(tx, original.initiatorId, offeredChanges(original));
      const lock = () => this.inventory.lock(tx, user.id, input.offered);
      if (original.initiatorId < user.id) {
        await release();
        await lock();
      } else {
        await lock();
        await release();
      }

      await this.audit.record(tx, {
        actorId: user.id,
        action: 'trade.propose',
        entity: 'Trade',
        entityId: created.id,
        meta: { from: null, to: 'PENDING', counteredTradeId: original.id },
      });
      return created;
    });

    await this.notify([original.initiatorId], 'trade.countered', row.id);
    return toTrade(row);
  }

  /**
   * PENDING: closed, its lock released. ACCEPTED: the swap reversed, or - if a
   * party no longer has what they received - refused with the reason and
   * nothing changed. Any other status is already over.
   */
  async voidTrade(admin: AuthUser, id: string, reason: string): Promise<Trade> {
    const trade = await this.loadAny(id);
    await this.prisma.withTransaction((tx) => this.voidIn(tx, admin, trade, reason));
    if (trade.status === 'ACCEPTED') {
      await Promise.all([
        this.inventory.invalidateSummary(trade.initiatorId),
        this.inventory.invalidateSummary(trade.recipientId),
      ]);
    }
    await this.notify([trade.initiatorId, trade.recipientId], 'trade.voided', trade.id);
    return this.read(id);
  }

  /**
   * The void itself, inside a transaction that always rolls back: a refusal is exactly the one
   * the void would give. Notifications and cache invalidation live in `voidTrade`, after its
   * commit, so a check never reaches them.
   */
  async voidCheck(admin: AuthUser, id: string): Promise<VoidCheck> {
    const trade = await this.loadAny(id);
    try {
      await this.prisma.withTransaction(async (tx) => {
        await this.voidIn(tx, admin, trade, 'void check');
        throw new DryRun();
      });
    } catch (error) {
      if (error instanceof DryRun) return { voidable: true };
      const code = error instanceof HttpException ? codeOf(error.getResponse()) : undefined;
      if (error instanceof HttpException && code !== undefined) {
        return { voidable: false, code, reason: error.message };
      }
      throw error;
    }
    throw new Error('unreachable: a void check always rolls back');
  }

  private async voidIn(
    tx: TransactionClient,
    admin: AuthUser,
    trade: TradeRow,
    reason: string,
  ): Promise<void> {
    if (trade.status === 'ACCEPTED') {
      await this.closer.close(tx, trade, {
        from: 'ACCEPTED',
        to: 'VOIDED',
        action: 'trade.void',
        actorId: admin.id,
        release: false,
        meta: { reason },
      });
      await this.settlement.reverse(tx, trade);
    } else {
      await this.closer.close(tx, trade, {
        to: 'VOIDED',
        action: 'trade.void',
        actorId: admin.id,
        release: true,
        meta: { reason },
      });
    }
  }

  private async loadAny(id: string): Promise<TradeRow> {
    const trade = await this.prisma.trade.findUnique({ where: { id }, select: TRADE_SELECT });
    if (trade === null) {
      throw new NotFoundException('Trade not found');
    }
    return trade;
  }

  private async finish(
    user: AuthUser,
    id: string,
    step: {
      role: Role;
      to: 'DECLINED' | 'CANCELLED';
      action: string;
      notify: TradeNotificationType;
    },
  ): Promise<Trade> {
    const trade = await this.loadAsParty(user, id);
    assertRole(trade, user, step.role);

    await this.prisma.withTransaction((tx) =>
      this.closer.close(tx, trade, {
        to: step.to,
        action: step.action,
        actorId: user.id,
        release: true,
      }),
    );

    await this.notify([counterparty(trade, user.id)], step.notify, trade.id);
    return this.read(id);
  }

  private async loadAsParty(user: AuthUser, id: string): Promise<TradeRow> {
    const trade = await this.prisma.trade.findUnique({ where: { id }, select: TRADE_SELECT });
    if (trade === null || (trade.initiatorId !== user.id && trade.recipientId !== user.id)) {
      throw new NotFoundException('Trade not found');
    }
    return trade;
  }

  private async read(id: string): Promise<Trade> {
    return toTrade(
      await this.prisma.trade.findUniqueOrThrow({ where: { id }, select: TRADE_SELECT }),
    );
  }

  /**
   * The recipient's holdings are not checked: an inventory is private, and a
   * refusal here would disclose it. Settlement checks.
   */
  private async assertTerms(initiatorId: string, terms: Terms): Promise<void> {
    const ids = [...terms.offered, ...terms.requested].map((line) => line.cardId);
    if (ids.length > 0) {
      const found = await this.prisma.card.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const known = new Set(found.map((card) => card.id));
      const unknown = ids.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new BadRequestException(`Unknown card: ${unknown.join(', ')}`);
      }
    }

    if (terms.currencyFromInitiator > 0) {
      const me = await this.prisma.user.findUniqueOrThrow({
        where: { id: initiatorId },
        select: { currency: true },
      });
      if (me.currency < terms.currencyFromInitiator) {
        throw domainError(
          HttpStatus.PAYMENT_REQUIRED,
          ERROR_CODES.INSUFFICIENT_FUNDS,
          'Not enough coins for this offer',
        );
      }
    }
  }

  private notify(userIds: string[], type: TradeNotificationType, tradeId: string): Promise<void> {
    return this.notifications.notify(
      userIds.map((userId) => ({ userId, type, payload: { tradeId } })),
    );
  }
}

function codeOf(body: unknown): string | undefined {
  return typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    typeof body.code === 'string'
    ? body.code
    : undefined;
}
