import { z } from 'zod';
import {
  AbilitySchema,
  AttackSchema,
  CardIdSchema,
  LegalitiesSchema,
  PriceSourceSchema,
  RaritySchema,
  ResistanceSchema,
  SetIdSchema,
  WeaknessSchema,
} from '@pokedrop/shared';

export const SetDTOSchema = z.object({
  id: SetIdSchema,
  name: z.string().min(1),
  series: z.string().min(1),
  releaseDate: z.date(),
  printedTotal: z.number().int().min(0),
  total: z.number().int().min(0),
  symbolUrl: z.url().nullable(),
  logoUrl: z.url().nullable(),
});
export type SetDTO = z.infer<typeof SetDTOSchema>;

/**
 * `latestPriceUsd`, `latestPriceEur` and `priceUpdatedAt` are absent on purpose:
 * they belong to the price path, and a type with no field for them cannot
 * express a catalog sync overwriting a fresh price with a stale one.
 */
export const CardDTOSchema = z.object({
  id: CardIdSchema,
  setId: SetIdSchema,
  name: z.string().min(1),
  supertype: z.string().min(1),
  subtypes: z.array(z.string()),
  hp: z.number().int().min(0).nullable(),
  types: z.array(z.string()),
  rarity: RaritySchema.nullable(),
  retreatCost: z.array(z.string()),
  weaknesses: z.array(WeaknessSchema),
  resistances: z.array(ResistanceSchema),
  attacks: z.array(AttackSchema),
  abilities: z.array(AbilitySchema),
  legalities: LegalitiesSchema,
  nationalPokedexNumbers: z.array(z.number().int().min(1)),
  imageSmall: z.url(),
  imageLarge: z.url(),
  tcgplayerId: z.string().nullable(),
  cardmarketId: z.string().nullable(),
});
export type CardDTO = z.infer<typeof CardDTOSchema>;

export const PriceDTOSchema = z.object({
  cardId: CardIdSchema,
  source: PriceSourceSchema,
  currency: z.string().length(3),
  market: z.number().nonnegative().nullable(),
  low: z.number().nonnegative().nullable(),
  mid: z.number().nonnegative().nullable(),
  high: z.number().nonnegative().nullable(),
  capturedAt: z.date(),
});
export type PriceDTO = z.infer<typeof PriceDTOSchema>;
