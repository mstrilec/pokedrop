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

/**
 * What a provider returns once its own mapper has run — provider-neutral by
 * construction, because the shape is taken from our Prisma models rather than
 * from any upstream payload.
 *
 * Dates are `z.date()` and not `z.coerce.date()` on purpose. The schemas in
 * @pokedrop/shared coerce because they serve both the wire and Prisma; here the
 * only producer is a mapper inside this folder, so accepting a string would do
 * nothing but hide a mapper that forgot to parse one.
 */
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
 * A card as the catalog path carries it.
 *
 * `latestPriceUsd`, `latestPriceEur` and `priceUpdatedAt` are absent, and their
 * absence is the point: those three columns belong to the price path
 * (docs/Architecture.md section 7), and a type with no field for them cannot
 * express an overwrite of a fresh price with a stale one. The separation is
 * structural rather than a convention somebody has to remember.
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

/**
 * One captured price point — what PriceSnapshot stores, minus its own id.
 *
 * A card yields up to two of these, one per source. `currency` is derived from
 * the source by the mapper rather than trusted from the payload.
 */
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
