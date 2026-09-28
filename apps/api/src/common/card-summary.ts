import type { Prisma } from '@prisma/client';
import { toNumber } from './decimal.js';

/** The slim card a reveal, a history row and a decklist show - the inventory's projection. */
export const CARD_SUMMARY_SELECT = {
  id: true,
  setId: true,
  name: true,
  supertype: true,
  subtypes: true,
  types: true,
  hp: true,
  rarity: true,
  imageSmall: true,
  latestPriceUsd: true,
  latestPriceEur: true,
  priceUpdatedAt: true,
} satisfies Prisma.CardSelect;

export type CardSummaryRow = Prisma.CardGetPayload<{ select: typeof CARD_SUMMARY_SELECT }>;

export function toCardSummary(row: CardSummaryRow): Record<string, unknown> {
  return {
    ...row,
    latestPriceUsd: toNumber(row.latestPriceUsd),
    latestPriceEur: toNumber(row.latestPriceEur),
  };
}
