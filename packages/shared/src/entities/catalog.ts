import { z } from 'zod';
import { CardSchema } from './card.js';
import { CardSetSchema } from './set.js';
import { PaginationQuerySchema, pageOf } from '../primitives/pagination.js';

export const CardSortSchema = z
  .enum(['name_asc', 'name_desc', 'price_desc', 'price_asc'])
  .default('name_asc');
export type CardSort = z.infer<typeof CardSortSchema>;

// PostgreSQL text cannot hold U+0000: a NUL reaching a query is a driver error
// and a 500, so it is refused here as a 400.
const filterText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !value.includes('\u0000'), 'must not contain a NUL character');

export const CardSearchQuerySchema = PaginationQuerySchema.extend({
  q: filterText(100).optional(),
  set: filterText(64).optional(),
  rarity: filterText(64).optional(),
  type: filterText(32).optional(),
  supertype: filterText(32).optional(),
  sort: CardSortSchema,
});
export type CardSearchQuery = z.infer<typeof CardSearchQuerySchema>;

export const CardSearchResultSchema = pageOf(CardSchema);
export type CardSearchResult = z.infer<typeof CardSearchResultSchema>;

export const SetDetailSchema = CardSetSchema.extend({
  cardCount: z.number().int().min(0),
});
export type SetDetail = z.infer<typeof SetDetailSchema>;

export const FacetValueSchema = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number().int().min(0),
});
export type FacetValue = z.infer<typeof FacetValueSchema>;

export const CatalogFacetsSchema = z.object({
  sets: z.array(FacetValueSchema),
  rarities: z.array(FacetValueSchema),
  types: z.array(FacetValueSchema),
  supertypes: z.array(FacetValueSchema),
});
export type CatalogFacets = z.infer<typeof CatalogFacetsSchema>;
