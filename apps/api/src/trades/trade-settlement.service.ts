import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
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
    await moveCoins(tx, trade, 'settle');
    await this.inventory.applyMoves(tx, cardMoves(trade));
  }

  /**
   * Inside the void transaction, after the guarded close from ACCEPTED. The
   * settlement run backwards, taking only copies and coins the parties still
   * have available - so a void either undoes the whole swap or, with the
   * reason, changes nothing.
   */
  async reverse(tx: TransactionClient, trade: TradeRow): Promise<void> {
    await moveCoins(tx, trade, 'reverse');
    try {
      await this.inventory.applyMoves(tx, reverseMoves(trade));
    } catch (error) {
      if (codeOf(error) === ERROR_CODES.CARDS_UNAVAILABLE && error instanceof HttpException) {
        throw domainError(
          HttpStatus.CONFLICT,
          ERROR_CODES.TRADE_NOT_REVERSIBLE,
          `Cannot reverse this trade: ${error.message}`,
        );
      }
      throw error;
    }
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

/** Every settled move inverted; a reversal gives from available copies only. */
function reverseMoves(trade: TradeRow): InventoryMove[] {
  return cardMoves(trade).map((move) => ({
    userId: move.userId,
    cardId: move.cardId,
    quantity: -move.quantity,
  }));
}

async function moveCoins(
  tx: TransactionClient,
  trade: TradeRow,
  direction: 'settle' | 'reverse',
): Promise<void> {
  const toInitiator = trade.currencyFromRecipient - trade.currencyFromInitiator;
  if (toInitiator === 0) {
    return;
  }
  const settledPayer = toInitiator > 0 ? trade.recipientId : trade.initiatorId;
  const settledPayee = settledPayer === trade.initiatorId ? trade.recipientId : trade.initiatorId;
  const [payer, payee] =
    direction === 'settle' ? [settledPayer, settledPayee] : [settledPayee, settledPayer];
  const amount = Math.abs(toInitiator);

  // Both user rows, ascending id, before any inventory row: the pack open takes
  // a user row and then that user's inventory, and the other order deadlocks.
  await tx.$queryRaw`
    SELECT id FROM users WHERE id IN (${payer}, ${payee}) ORDER BY id FOR NO KEY UPDATE`;

  const debited = await tx.$executeRaw`
    UPDATE users SET currency = currency - ${amount}
    WHERE id = ${payer} AND currency >= ${amount}`;
  if (debited === 0 && direction === 'reverse') {
    throw domainError(
      HttpStatus.CONFLICT,
      ERROR_CODES.TRADE_NOT_REVERSIBLE,
      `Cannot reverse this trade: user ${payer} no longer has the ${amount} coins it paid them`,
    );
  }
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

  const type = direction === 'settle' ? 'TRADE' : 'TRADE_REVERSAL';
  await tx.currencyTransaction.createMany({
    data: [
      { userId: payer, amount: -amount, type, refId: trade.id },
      { userId: payee, amount, type, refId: trade.id },
    ],
  });
}

function codeOf(error: unknown): unknown {
  if (!(error instanceof HttpException)) {
    return undefined;
  }
  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'code' in response
    ? response.code
    : undefined;
}
