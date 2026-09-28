import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@pokedrop/shared';
import { domainError } from '../common/errors/domain-error.js';
import { InventoryService, type InventoryMove } from '../inventory/index.js';
import type { TransactionClient } from '../prisma/index.js';
import type { TradeRow } from './trade-row.js';

@Injectable()
export class TradeSettlementService {
  constructor(private readonly inventory: InventoryService) {}

  /** Inside the accept transaction, after the guarded close. Coins before cards: see moveCoins. */
  async settle(tx: TransactionClient, trade: TradeRow): Promise<void> {
    await moveCoins(tx, trade);
    await this.inventory.applyMoves(tx, cardMoves(trade));
  }
}

export function cardMoves(trade: TradeRow): InventoryMove[] {
  return trade.items.flatMap((item): InventoryMove[] =>
    item.side === 'OFFERED'
      ? [
          {
            userId: trade.initiatorId,
            cardId: item.cardId,
            quantity: -item.quantity,
            fromLock: true,
          },
          { userId: trade.recipientId, cardId: item.cardId, quantity: item.quantity },
        ]
      : [
          { userId: trade.recipientId, cardId: item.cardId, quantity: -item.quantity },
          { userId: trade.initiatorId, cardId: item.cardId, quantity: item.quantity },
        ],
  );
}

async function moveCoins(tx: TransactionClient, trade: TradeRow): Promise<void> {
  const toInitiator = trade.currencyFromRecipient - trade.currencyFromInitiator;
  if (toInitiator === 0) {
    return;
  }
  const payer = toInitiator > 0 ? trade.recipientId : trade.initiatorId;
  const payee = payer === trade.initiatorId ? trade.recipientId : trade.initiatorId;
  const amount = Math.abs(toInitiator);

  // Both user rows, ascending id, before any inventory row: the pack open takes
  // a user row and then that user's inventory, and the other order deadlocks.
  await tx.$queryRaw`
    SELECT id FROM users WHERE id IN (${payer}, ${payee}) ORDER BY id FOR NO KEY UPDATE`;

  const debited = await tx.$executeRaw`
    UPDATE users SET currency = currency - ${amount}
    WHERE id = ${payer} AND currency >= ${amount}`;
  if (debited === 0) {
    throw domainError(
      HttpStatus.PAYMENT_REQUIRED,
      ERROR_CODES.INSUFFICIENT_FUNDS,
      payer === trade.recipientId
        ? 'You do not have the coins this trade asks for'
        : 'The other party no longer has the coins this trade offers',
    );
  }
  await tx.$executeRaw`UPDATE users SET currency = currency + ${amount} WHERE id = ${payee}`;

  await tx.currencyTransaction.createMany({
    data: [
      { userId: payer, amount: -amount, type: 'TRADE', refId: trade.id },
      { userId: payee, amount, type: 'TRADE', refId: trade.id },
    ],
  });
}
