import { z } from 'zod';
import { RaritySchema } from '../enums.js';
import { CardIdSchema, SetIdSchema } from '../primitives/id.js';

export const WeaknessSchema = z.object({
  type: z.string(),
  value: z.string(),
});
export type Weakness = z.infer<typeof WeaknessSchema>;

export const ResistanceSchema = z.object({
  type: z.string(),
  value: z.string(),
});
export type Resistance = z.infer<typeof ResistanceSchema>;

export const AttackSchema = z.object({
  name: z.string(),
  cost: z.array(z.string()),
  convertedEnergyCost: z.number().int().min(0),
  damage: z.string(),
  text: z.string(),
});
export type Attack = z.infer<typeof AttackSchema>;

export const AbilitySchema = z.object({
  name: z.string(),
  text: z.string(),
  type: z.string(),
});
export type Ability = z.infer<typeof AbilitySchema>;

export const LegalitiesSchema = z.record(z.string(), z.string());
export type Legalities = z.infer<typeof LegalitiesSchema>;

export const CardSchema = z.object({
  id: CardIdSchema,
  setId: SetIdSchema,
  name: z.string().min(1),
  supertype: z.string(),
  subtypes: z.array(z.string()),
  hp: z.number().int().min(0).nullable(),
  types: z.array(z.string()),
  rarity: RaritySchema.nullable(),
  retreatCost: z.array(z.string()),
  weaknesses: z.array(WeaknessSchema),
  resistances: z.array(ResistanceSchema),
  attacks: z.array(AttackSchema),
  abilities: z.array(AbilitySchema),
  nationalPokedexNumbers: z.array(z.number().int().min(1)),
  imageSmall: z.url(),
  imageLarge: z.url(),
  legalities: LegalitiesSchema,
  tcgplayerId: z.string().nullable(),
  cardmarketId: z.string().nullable(),
  latestPriceUsd: z.number().nonnegative().nullable(),
  latestPriceEur: z.number().nonnegative().nullable(),
  priceUpdatedAt: z.coerce.date().nullable(),
});
export type Card = z.infer<typeof CardSchema>;
