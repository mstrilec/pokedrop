import { z } from 'zod';
import { DeckFormatSchema, type DeckFormat } from '../entities/deck.js';
import { PlayableCardSchema } from '../entities/inventory.js';
import { CardIdSchema } from '../primitives/id.js';

export const BASIC_ENERGY_TYPES = [
  'Grass',
  'Fire',
  'Water',
  'Lightning',
  'Psychic',
  'Fighting',
  'Darkness',
  'Metal',
  'Fairy',
] as const;
export const BasicEnergyTypeSchema = z.enum(BASIC_ENERGY_TYPES);
export type BasicEnergyType = z.infer<typeof BasicEnergyTypeSchema>;

/** `Basic Fire Energy` and `Fire Energy` are Fire; a basic Energy's `types` is often empty. */
export function basicEnergyTypeOf(name: string): BasicEnergyType | null {
  const parsed = BasicEnergyTypeSchema.safeParse(
    name.replace(/^Basic /, '').replace(/ Energy$/, ''),
  );
  return parsed.success ? parsed.data : null;
}

export const RandomDeckRequestSchema = z.strictObject({
  format: DeckFormatSchema,
  ownedOnly: z.boolean(),
  types: z
    .array(BasicEnergyTypeSchema)
    .max(2)
    .refine((types) => new Set(types).size === types.length, 'A type is chosen twice'),
  seed: z.string().min(1).max(64).optional(),
});
export type RandomDeckRequest = z.infer<typeof RandomDeckRequestSchema>;

export const SHORTFALL_CODES = [
  'NOT_ENOUGH_POKEMON',
  'NOT_ENOUGH_TRAINERS',
  'NOT_ENOUGH_ENERGY',
] as const;
export type ShortfallCode = (typeof SHORTFALL_CODES)[number];

export const RandomDeckShortfallSchema = z.object({
  result: z.literal('shortfall'),
  code: z.enum(SHORTFALL_CODES),
  type: BasicEnergyTypeSchema.nullable(),
  have: z.number().int().min(0),
  need: z.number().int().min(1),
  message: z.string().min(1),
});
export type RandomDeckShortfall = z.infer<typeof RandomDeckShortfallSchema>;

export const RandomDeckResponseSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('deck'),
    format: DeckFormatSchema,
    types: z.array(BasicEnergyTypeSchema),
    cards: z.array(
      z.object({ cardId: CardIdSchema, count: z.number().int().min(1), card: PlayableCardSchema }),
    ),
  }),
  RandomDeckShortfallSchema,
]);
export type RandomDeckResponse = z.infer<typeof RandomDeckResponseSchema>;

/** The types each format can generate: a basic Energy of the type is Legal in it. */
export const RandomDeckTypesSchema = z.record(DeckFormatSchema, z.array(BasicEnergyTypeSchema));
export type RandomDeckTypes = Record<DeckFormat, BasicEnergyType[]>;
