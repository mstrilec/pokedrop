import { z } from 'zod';

export const RawPricesSchema = z.record(z.string(), z.unknown());

export const RawSetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  series: z.string().min(1),
  releaseDate: z.string().min(1),
  printedTotal: z.number().int().min(0).optional(),
  total: z.number().int().min(0),
  images: z
    .object({
      symbol: z.string().optional(),
      logo: z.string().optional(),
    })
    .optional(),
});
export type RawSet = z.infer<typeof RawSetSchema>;

export const RawCardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  supertype: z.string().min(1),
  subtypes: z.array(z.string()).optional(),
  hp: z.string().optional(),
  types: z.array(z.string()).optional(),
  rarity: z.string().optional(),
  retreatCost: z.array(z.string()).optional(),
  nationalPokedexNumbers: z.array(z.number().int()).optional(),
  evolvesFrom: z.string().optional(),
  images: z.object({
    small: z.string().min(1),
    large: z.string().min(1),
  }),
  legalities: z.record(z.string(), z.string()).optional(),
  weaknesses: z.array(z.object({ type: z.string(), value: z.string() })).optional(),
  resistances: z.array(z.object({ type: z.string(), value: z.string() })).optional(),
  attacks: z
    .array(
      z.object({
        name: z.string(),
        cost: z.array(z.string()).optional(),
        convertedEnergyCost: z.number().int().min(0).optional(),
        damage: z.string().optional(),
        text: z.string().optional(),
      }),
    )
    .optional(),
  abilities: z
    .array(
      z.object({
        name: z.string(),
        text: z.string().optional(),
        type: z.string().optional(),
      }),
    )
    .optional(),
  set: z.object({ id: z.string().min(1) }),
  tcgplayer: z.object({ prices: RawPricesSchema.optional() }).optional(),
  cardmarket: z.object({ prices: RawPricesSchema.optional() }).optional(),
});
export type RawCard = z.infer<typeof RawCardSchema>;

/**
 * `data` stays `unknown[]`: items are parsed one at a time, so one malformed card cannot fail
 * the page.
 */
export const ListEnvelopeSchema = z.object({
  data: z.array(z.unknown()),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  count: z.number().int().min(0),
  totalCount: z.number().int().min(0),
});
export type ListEnvelope = z.infer<typeof ListEnvelopeSchema>;
