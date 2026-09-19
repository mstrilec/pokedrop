import { z } from 'zod';
import { CardSchema } from './card.js';
import { CardSetSchema } from './set.js';
import { PaginationQuerySchema, pageOf } from '../primitives/pagination.js';

/**
 * One field, two directions.
 *
 * Price columns are null until the price sync exists, and a meaningful rarity
 * order needs RarityTier, which is a presentation concept rather than a column.
 * Adding a sort is one entry here plus one branch in the service.
 */
export const CardSortSchema = z.enum(['name_asc', 'name_desc']).default('name_asc');
export type CardSort = z.infer<typeof CardSortSchema>;

/**
 * Every filter is optional and absent means "no filter".
 */
export const CardSearchQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  set: z.string().trim().min(1).max(64).optional(),
  rarity: z.string().trim().min(1).max(64).optional(),
  /**
   * One type, matched by array containment. A card carries at most two, and the
   * FilterBar is a single dropdown.
   */
  type: z.string().trim().min(1).max(32).optional(),
  sort: CardSortSchema,
});
export type CardSearchQuery = z.infer<typeof CardSearchQuerySchema>;

/**
 * Named `CardSearchResult` rather than `CardPage`, because
 * `sync/providers/card-source-provider.ts` already exports a `CardPage` - the
 * provider-side page of a fetch. Two types with one name in one codebase is a
 * collision waiting for the file that imports both.
 */
export const CardSearchResultSchema = pageOf(CardSchema);
export type CardSearchResult = z.infer<typeof CardSearchResultSchema>;

/**
 * A set plus how many cards the mirror holds for it, which is not the same as
 * `total`: `total` is what the provider says the set contains, and `cardCount`
 * is what we actually have. They differ while a sync is still filling in pages.
 */
export const SetDetailSchema = CardSetSchema.extend({
  cardCount: z.number().int().min(0),
});
export type SetDetail = z.infer<typeof SetDetailSchema>;
