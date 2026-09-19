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
  /**
   * Added by the facets ticket rather than by the search ticket. The facets
   * endpoint has to return supertypes, and a facet nobody can filter by is a
   * list of values the API advertises and then rejects.
   */
  supertype: z.string().trim().min(1).max(32).optional(),
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

/**
 * One shape for all four facets, so a filter dropdown has one renderer.
 *
 * `label` differs from `value` only for sets, where the value is an id like
 * `base1` and nobody wants that in a dropdown. Keeping the field on the other
 * three costs a duplicated string and saves the frontend a special case.
 */
export const FacetValueSchema = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number().int().min(0),
});
export type FacetValue = z.infer<typeof FacetValueSchema>;

/**
 * Global counts over the whole mirror, not counts conditional on the filters
 * already applied. Conditional facets cannot share one cache key, and
 * docs/Architecture.md section 8 gives this one key with a 24h TTL.
 */
export const CatalogFacetsSchema = z.object({
  sets: z.array(FacetValueSchema),
  rarities: z.array(FacetValueSchema),
  types: z.array(FacetValueSchema),
  supertypes: z.array(FacetValueSchema),
});
export type CatalogFacets = z.infer<typeof CatalogFacetsSchema>;
