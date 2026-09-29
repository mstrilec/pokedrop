import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma, TradeStatus } from '@prisma/client';
import { ERROR_CODES } from '@pokedrop/shared';
import { AuditService } from '../audit/index.js';
import { domainError } from '../common/errors/domain-error.js';
import { InventoryService } from '../inventory/index.js';
import type { TransactionClient } from '../prisma/index.js';
import { offeredChanges, type TradeRow } from './trade-row.js';

/**
 * `release` returns the initiator's OFFERED lock, which only a PENDING trade
 * holds - so leaving ACCEPTED can never release. A settled trade's cards were
 * already moved; releasing "its" lock would strip one belonging to another of
 * the initiator's pending trades, and nothing would notice.
 */
export type CloseOptions = {
  to: Exclude<TradeStatus, 'PENDING'>;
  action: string;
  actorId: string | null;
  meta?: Prisma.InputJsonObject;
} & (
  | {
      from?: 'PENDING';
      /** False for accept, whose settlement consumes the lock, and for counter, which releases in lock order. */
      release: boolean;
    }
  | { from: 'ACCEPTED'; release: false }
);

@Injectable()
export class TradeCloseService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The only way a trade changes status. The guarded update takes the trade's
   * row lock first, so every transition of one trade is serialised and the
   * loser of a race finds it no longer in the status it expected.
   */
  async close(
    tx: TransactionClient,
    trade: Pick<TradeRow, 'id' | 'initiatorId' | 'items'>,
    options: CloseOptions,
  ): Promise<void> {
    const from = options.from ?? 'PENDING';
    const { count } = await tx.trade.updateMany({
      where: { id: trade.id, status: from },
      data: { status: options.to, resolvedAt: new Date() },
    });
    if (count === 0) {
      const current = await tx.trade.findUnique({
        where: { id: trade.id },
        select: { status: true },
      });
      throw domainError(
        HttpStatus.CONFLICT,
        from === 'PENDING' ? ERROR_CODES.TRADE_NOT_PENDING : ERROR_CODES.TRADE_NOT_REVERSIBLE,
        `This trade is already ${current?.status ?? 'gone'}`,
      );
    }

    if (options.release) {
      await this.inventory.release(tx, trade.initiatorId, offeredChanges(trade));
    }

    await this.audit.record(tx, {
      actorId: options.actorId,
      action: options.action,
      entity: 'Trade',
      entityId: trade.id,
      meta: { ...options.meta, from, to: options.to },
    });
  }

  /**
   * `close` for every PENDING trade a user is party to, in a fixed number of
   * statements however many there are: a spammer's thousands of proposals
   * must not push a suspension past the transaction timeout. The rows are
   * locked in id order, and one an accept is settling is waited for and, no
   * longer PENDING, skipped - the same serialisation `close` gets.
   */
  async voidAllPendingOf(
    tx: TransactionClient,
    userId: string,
    actorId: string,
    meta: Prisma.InputJsonObject,
  ): Promise<VoidedTrade[]> {
    const voided = await tx.$queryRaw<VoidedTrade[]>`
      UPDATE trades SET status = 'VOIDED', "resolvedAt" = now()
      WHERE status = 'PENDING' AND id IN (
        SELECT id FROM trades
        WHERE status = 'PENDING' AND ${userId} IN ("initiatorId", "recipientId")
        ORDER BY id
        FOR UPDATE
      )
      RETURNING id, "initiatorId", "recipientId"`;
    if (voided.length === 0) {
      return [];
    }

    const initiatorOf = new Map(voided.map((trade) => [trade.id, trade.initiatorId]));
    const offered = await tx.tradeItem.findMany({
      where: { tradeId: { in: [...initiatorOf.keys()] }, side: 'OFFERED' },
      select: { tradeId: true, cardId: true, quantity: true },
    });
    const locked = new Map<string, Map<string, number>>();
    for (const item of offered) {
      const initiator = initiatorOf.get(item.tradeId) ?? '';
      const cards = locked.get(initiator) ?? new Map<string, number>();
      cards.set(item.cardId, (cards.get(item.cardId) ?? 0) + item.quantity);
      locked.set(initiator, cards);
    }
    for (const initiator of [...locked.keys()].sort()) {
      const cards = locked.get(initiator) ?? new Map<string, number>();
      await this.inventory.release(
        tx,
        initiator,
        [...cards].map(([cardId, quantity]) => ({ cardId, quantity })),
      );
    }

    await tx.auditLog.createMany({
      data: voided.map((trade) => ({
        actorId,
        action: 'trade.void',
        entity: 'Trade',
        entityId: trade.id,
        meta: { ...meta, from: 'PENDING', to: 'VOIDED' },
      })),
    });
    return voided;
  }
}

export type VoidedTrade = { id: string; initiatorId: string; recipientId: string };
