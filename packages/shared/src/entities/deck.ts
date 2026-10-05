import { z } from 'zod';
import { CardIdSchema, DeckCardIdSchema, DeckIdSchema, UserIdSchema } from '../primitives/id.js';
import { PaginationQuerySchema, pageOf } from '../primitives/pagination.js';
import { InventoryCardSchema } from './inventory.js';

export const DeckCardSchema = z.object({
  id: DeckCardIdSchema,
  deckId: DeckIdSchema,
  cardId: CardIdSchema,
  count: z.number().int().min(1),
});
export type DeckCard = z.infer<typeof DeckCardSchema>;

export const DECK_NAME_MAX = 64;

/** `format` is open on the way out, like the column; inputs are held to `DeckFormatSchema`. */
export const DeckSchema = z.object({
  id: DeckIdSchema,
  userId: UserIdSchema,
  name: z.string().min(1).max(DECK_NAME_MAX),
  format: z.string().min(1),
  isPublic: z.boolean(),
  ownedOnly: z.boolean(),
  cards: z.array(DeckCardSchema),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Deck = z.infer<typeof DeckSchema>;

export const DECK_FORMATS = ['standard', 'expanded', 'unlimited'] as const;
export const DeckFormatSchema = z.enum(DECK_FORMATS);
export type DeckFormat = z.infer<typeof DeckFormatSchema>;

/**
 * Request bounds, not deck rules. Deck size and the copy limit belong to the
 * validation engine; these only keep a request from being absurd.
 */
export const MAX_DECK_ENTRIES = 100;
export const MAX_DECK_CARD_COUNT = 100;

export const DeckCardInputSchema = z.strictObject({
  cardId: CardIdSchema,
  count: z.number().int().min(1).max(MAX_DECK_CARD_COUNT),
});
export type DeckCardInput = z.infer<typeof DeckCardInputSchema>;

export const DeckCardsInputSchema = z
  .array(DeckCardInputSchema)
  .max(MAX_DECK_ENTRIES)
  .refine((cards) => new Set(cards.map((card) => card.cardId)).size === cards.length, {
    message: 'A card may appear once; put its copies in count',
  });

const DeckNameSchema = z.string().trim().min(1).max(DECK_NAME_MAX);

export const CreateDeckSchema = z.strictObject({
  name: DeckNameSchema,
  format: DeckFormatSchema,
  isPublic: z.boolean().default(false),
  ownedOnly: z.boolean().default(false),
  cards: DeckCardsInputSchema.default([]),
});
export type CreateDeck = z.infer<typeof CreateDeckSchema>;

/** `cards`, when present, replaces the whole decklist. */
export const UpdateDeckSchema = z
  .strictObject({
    name: DeckNameSchema.optional(),
    format: DeckFormatSchema.optional(),
    isPublic: z.boolean().optional(),
    ownedOnly: z.boolean().optional(),
    cards: DeckCardsInputSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to update' });
export type UpdateDeck = z.infer<typeof UpdateDeckSchema>;

export const DeckEntrySchema = DeckCardSchema.pick({ cardId: true, count: true }).extend({
  card: InventoryCardSchema,
});
export type DeckEntry = z.infer<typeof DeckEntrySchema>;

export const DeckDetailSchema = DeckSchema.extend({
  ownerDisplayName: z.string(),
  cards: z.array(DeckEntrySchema),
});
export type DeckDetail = z.infer<typeof DeckDetailSchema>;

/** `cardCount` is the sum of copies, not the number of distinct cards. */
export const DeckSummarySchema = DeckSchema.omit({ cards: true }).extend({
  cardCount: z.number().int().min(0),
});
export type DeckSummary = z.infer<typeof DeckSummarySchema>;

export const DeckListQuerySchema = PaginationQuerySchema;
export type DeckListQuery = z.infer<typeof DeckListQuerySchema>;

export const DeckPageSchema = pageOf(DeckSummarySchema);
export type DeckPage = z.infer<typeof DeckPageSchema>;

/**
 * The owner's list: each deck with `valid`, the validator's verdict computed when read. Never
 * on a public shelf — the verdict depends on the owner's copies, which are private.
 */
export const OwnDeckSummarySchema = DeckSummarySchema.extend({ valid: z.boolean() });
export type OwnDeckSummary = z.infer<typeof OwnDeckSummarySchema>;

export const OwnDeckPageSchema = pageOf(OwnDeckSummarySchema);
export type OwnDeckPage = z.infer<typeof OwnDeckPageSchema>;

/** One bar or slice, in the `{ name, value }` rows Recharts reads as they are. */
export const ChartDatumSchema = z.object({
  name: z.string(),
  value: z.number().int().min(0),
});
export type ChartDatum = z.infer<typeof ChartDatumSchema>;

export const DECK_SUPERTYPES = ['Pokémon', 'Trainer', 'Energy'] as const;

/**
 * Every value counts copies. `supertypes` always holds the three supertypes in
 * that order, zeros included; `types` and `rarities` hold only what the deck
 * has, largest first. A dual-type Pokémon counts once under each type, so
 * `types` can sum past the Pokémon count.
 */
export const DeckStatsSchema = z.object({
  totalCards: z.number().int().min(0),
  energyCount: z.number().int().min(0),
  supertypes: z.array(ChartDatumSchema),
  types: z.array(ChartDatumSchema),
  rarities: z.array(ChartDatumSchema),
});
export type DeckStats = z.infer<typeof DeckStatsSchema>;

export const DECK_MAX_COPIES = 4;

/** A card's name without a printing suffix: `Charizard (Delta Species)` is a `Charizard`. */
export function baseCardName(name: string): string {
  return name.replace(/ \([^)]*\)$/, '');
}

/**
 * What the copy limit counts by: every printing of a name shares one key. Basic energy is
 * unlimited and has none. The API's validator and the deck builder must agree on this.
 */
export function copyLimitKey(card: {
  name: string;
  supertype: string;
  subtypes: readonly string[];
}): string | null {
  if (card.supertype === 'Energy' && card.subtypes.includes('Basic')) return null;
  return baseCardName(card.name).toLowerCase();
}

export const DECK_RULES = ['DECK_SIZE', 'COPY_LIMIT', 'FORMAT_LEGALITY', 'OWNERSHIP'] as const;
export const DeckRuleSchema = z.enum(DECK_RULES);
export type DeckRule = z.infer<typeof DeckRuleSchema>;

export const DECK_ISSUE_CODES = [
  'DECK_SIZE_MISMATCH',
  'COPY_LIMIT_EXCEEDED',
  'CARD_BANNED',
  'CARD_NOT_LEGAL',
  'CARD_LEGALITY_UNKNOWN',
  'CARD_NOT_OWNED',
] as const;
export const DeckIssueCodeSchema = z.enum(DECK_ISSUE_CODES);
export type DeckIssueCode = z.infer<typeof DeckIssueCodeSchema>;

/**
 * `code` and `params` are the localisable part; `message` is an English
 * fallback and may be reworded. `cardIds` addresses the decklist rows the
 * issue is about; `[]` means the whole deck.
 */
export const DeckIssueSchema = z.object({
  severity: z.enum(['error', 'warning']),
  rule: DeckRuleSchema,
  code: DeckIssueCodeSchema,
  cardIds: z.array(CardIdSchema),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
  message: z.string(),
});
export type DeckIssue = z.infer<typeof DeckIssueSchema>;

/** One row per rule, always in `DECK_RULES` order; a warning never fails a rule. */
export const DeckRuleResultSchema = z.object({
  rule: DeckRuleSchema,
  ok: z.boolean(),
  errors: z.number().int().min(0),
  warnings: z.number().int().min(0),
});
export type DeckRuleResult = z.infer<typeof DeckRuleResultSchema>;

export const DeckValidationSchema = z.object({
  valid: z.boolean(),
  format: z.string(),
  ownedOnly: z.boolean(),
  deckSize: z.object({
    expected: z.number().int().min(1),
    actual: z.number().int().min(0),
  }),
  rules: z.array(DeckRuleResultSchema),
  issues: z.array(DeckIssueSchema),
});
export type DeckValidation = z.infer<typeof DeckValidationSchema>;

export const DeckSaveResultSchema = DeckDetailSchema.extend({
  validation: DeckValidationSchema,
});
export type DeckSaveResult = z.infer<typeof DeckSaveResultSchema>;
