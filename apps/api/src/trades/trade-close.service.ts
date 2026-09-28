import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma, TradeStatus } from '@prisma/client';
import { ERROR_CODES } from '@pokedrop/shared';
import { AuditService } from '../audit/index.js';
import { domainError } from '../common/errors/domain-error.js';
import { InventoryService } from '../inventory/index.js';
import type { TransactionClient } from '../prisma/index.js';
import { offeredChanges, type TradeRow } from './trade-row.js';

export type CloseOptions = {
  to: Exclude<TradeStatus, 'PENDING'>;
  action: string;
  actorId: string | null;
  /** False for accept, whose settlement consumes the lock, and for counter, which releases in lock order. */
  release: boolean;
  meta?: Prisma.InputJsonObject;
};

@Injectable()
export class TradeCloseService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The only way out of PENDING. The guarded update takes the trade's row lock
   * first, so every transition of one trade is serialised and the loser of a
   * race finds it no longer PENDING.
   */
  async close(
    tx: TransactionClient,
    trade: Pick<TradeRow, 'id' | 'initiatorId' | 'items'>,
    options: CloseOptions,
  ): Promise<void> {
    const { count } = await tx.trade.updateMany({
      where: { id: trade.id, status: 'PENDING' },
      data: { status: options.to, resolvedAt: new Date() },
    });
    if (count === 0) {
      const current = await tx.trade.findUnique({
        where: { id: trade.id },
        select: { status: true },
      });
      throw domainError(
        HttpStatus.CONFLICT,
        ERROR_CODES.TRADE_NOT_PENDING,
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
      meta: { from: 'PENDING', to: options.to, ...options.meta },
    });
  }
}
