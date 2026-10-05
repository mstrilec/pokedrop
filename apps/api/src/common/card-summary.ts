import type { Prisma } from '@prisma/client';
import { LegalitiesSchema, type Legalities } from '@pokedrop/shared';
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

/** The summary plus legalities, for the deck builder: decklists and inventory entries. */
export const PLAYABLE_CARD_SELECT = {
  ...CARD_SUMMARY_SELECT,
  legalities: true,
} satisfies Prisma.CardSelect;

export type PlayableCardRow = Prisma.CardGetPayload<{ select: typeof PLAYABLE_CARD_SELECT }>;

export function toPlayableCard(row: PlayableCardRow): Record<string, unknown> {
  return { ...toCardSummary(row), legalities: toLegalities(row.legalities) };
}

/** A malformed column reads as "no legality recorded", which the validator warns about. */
export function toLegalities(value: Prisma.JsonValue): Legalities {
  const parsed = LegalitiesSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
