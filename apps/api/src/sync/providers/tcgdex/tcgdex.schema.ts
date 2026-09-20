import { z } from 'zod';

/**
 * What TCGdex actually sends, not what the DTOs want. Every field the mapper
 * reads is declared here, and everything optional is optional because a live
 * payload was seen without it.
 *
 * `.loose()` throughout: this provider adds fields (`variants_detailed`,
 * `illustrator`, `boosters`) without warning, and a strict object would turn a
 * harmless addition into a ProviderContractError across the whole catalog.
 */

const CardCountSchema = z.looseObject({
  total: z.number().int().min(0),
  official: z.number().int().min(0),
});

export const RawSetBriefSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type RawSetBrief = z.infer<typeof RawSetBriefSchema>;

export const RawSetSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  serie: z.looseObject({ id: z.string(), name: z.string() }),
  releaseDate: z.string().min(1),
  cardCount: CardCountSchema,
  logo: z.string().optional(),
  symbol: z.string().optional(),
});
export type RawSet = z.infer<typeof RawSetSchema>;

export const RawCardBriefSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  image: z.string().optional(),
});
export type RawCardBrief = z.infer<typeof RawCardBriefSchema>;

const RawAttackSchema = z.looseObject({
  name: z.string(),
  cost: z.array(z.string()).optional(),
  effect: z.string().optional(),
  damage: z.union([z.string(), z.number()]).optional(),
});

const RawAbilitySchema = z.looseObject({
  name: z.string(),
  type: z.string().optional(),
  effect: z.string().optional(),
});

// `value` is optional because live payloads omit it: all 17 of `pop1` and 13
// of `pop2` carry a weakness with a `type` and no `value` - the damage
// multiplier is unpublished, not the weakness itself. Requiring it here would
// fail RawCardSchema.safeParse for those cards and drop them from the index
// entirely, when the mapper can keep the card and default the missing string.
const RawTypeValueSchema = z.looseObject({
  type: z.string(),
  value: z.string().optional(),
});

export const RawCardSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  set: z.looseObject({ id: z.string().min(1) }),
  image: z.string().optional(),
  rarity: z.string().optional(),
  hp: z.number().optional(),
  types: z.array(z.string()).optional(),
  stage: z.string().optional(),
  retreat: z.number().int().min(0).optional(),
  dexId: z.array(z.number().int()).optional(),
  attacks: z.array(RawAttackSchema).optional(),
  abilities: z.array(RawAbilitySchema).optional(),
  weaknesses: z.array(RawTypeValueSchema).optional(),
  resistances: z.array(RawTypeValueSchema).optional(),
  legal: z.looseObject({ standard: z.boolean(), expanded: z.boolean() }).optional(),
  variants_detailed: z
    .array(
      z.looseObject({
        thirdParty: z
          .looseObject({
            tcgplayer: z.number().optional(),
            cardmarket: z.number().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  pricing: z
    .looseObject({
      cardmarket: z
        .looseObject({
          avg: z.number().nullable().optional(),
          low: z.number().nullable().optional(),
          trend: z.number().nullable().optional(),
        })
        .nullable()
        .optional(),
      tcgplayer: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .optional(),
});
export type RawCard = z.infer<typeof RawCardSchema>;

export const RawSetBriefListSchema = z.array(RawSetBriefSchema);
export const RawCardBriefListSchema = z.array(RawCardBriefSchema);
