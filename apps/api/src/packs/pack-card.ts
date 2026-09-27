import type { Prisma } from '@prisma/client';
import { toNumber } from '../common/decimal.js';

/** The slim card a reveal and a history row show - the inventory's projection. */
export const PACK_CARD_SELECT = {
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

export type PackCardRow = Prisma.CardGetPayload<{ select: typeof PACK_CARD_SELECT }>;

export function toPackCard(row: PackCardRow): Record<string, unknown> {
  return {
    ...row,
    latestPriceUsd: toNumber(row.latestPriceUsd),
    latestPriceEur: toNumber(row.latestPriceEur),
  };
}
