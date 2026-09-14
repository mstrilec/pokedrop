import { z } from 'zod';
import { CardIdSchema, DeckCardIdSchema, DeckIdSchema, UserIdSchema } from '../primitives/id.js';

export const DeckCardSchema = z.object({
  id: DeckCardIdSchema,
  deckId: DeckIdSchema,
  cardId: CardIdSchema,
  count: z.number().int().min(1),
});
export type DeckCard = z.infer<typeof DeckCardSchema>;

/**
 * `format` is an open string rather than an enum: legality comes from the
 * card's own `legalities` map, which the provider extends with new formats.
 */
export const DeckSchema = z.object({
  id: DeckIdSchema,
  userId: UserIdSchema,
  name: z.string().min(1).max(64),
  format: z.string().min(1),
  isPublic: z.boolean(),
  cards: z.array(DeckCardSchema),
  createdAt: z.coerce.date(),
});
export type Deck = z.infer<typeof DeckSchema>;
