import type { Prisma } from '@prisma/client';
import { TradeSchema, type Trade, type TradeLine } from '@pokedrop/shared';
import type { QuantityChange } from '../inventory/index.js';

export const TRADE_SELECT = {
  id: true,
  initiatorId: true,
  recipientId: true,
  status: true,
  currencyFromInitiator: true,
  currencyFromRecipient: true,
  counteredTradeId: true,
  createdAt: true,
  resolvedAt: true,
  items: {
    orderBy: [{ side: 'asc' }, { cardId: 'asc' }],
    select: { id: true, tradeId: true, side: true, cardId: true, quantity: true },
  },
} satisfies Prisma.TradeSelect;

export type TradeRow = Prisma.TradeGetPayload<{ select: typeof TRADE_SELECT }>;

export function toTrade(row: TradeRow): Trade {
  return TradeSchema.parse(row);
}

export function offeredChanges(trade: Pick<TradeRow, 'items'>): QuantityChange[] {
  return trade.items
    .filter((item) => item.side === 'OFFERED')
    .map((item) => ({ cardId: item.cardId, quantity: item.quantity }));
}

export function tradeLines(terms: { offered: TradeLine[]; requested: TradeLine[] }) {
  return [
    ...terms.offered.map((line) => ({
      side: 'OFFERED' as const,
      cardId: line.cardId,
      quantity: line.quantity,
    })),
    ...terms.requested.map((line) => ({
      side: 'REQUESTED' as const,
      cardId: line.cardId,
      quantity: line.quantity,
    })),
  ];
}
