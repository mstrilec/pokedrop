import {
  CardSchema,
  type CardSearchQuerySchema,
  CardSearchResultSchema,
  CardSetSchema,
  CatalogFacetsSchema,
  PriceHistorySchema,
  SetDetailSchema,
} from '@pokedrop/shared';
import { z } from 'zod';
import { get } from '../core';

export type CardSearchParams = z.input<typeof CardSearchQuerySchema>;

export const facets = () => get('/facets', CatalogFacetsSchema);

// Card ids carry `?` and `!` (`ex10-?`): encoded, or `?` starts a query string.
export const card = (id: string) => get(`/cards/${encodeURIComponent(id)}`, CardSchema);

export const priceHistory = (id: string, days = 30) =>
  get(`/cards/${encodeURIComponent(id)}/price/history`, PriceHistorySchema, { days });

export const set = (id: string) => get(`/sets/${encodeURIComponent(id)}`, SetDetailSchema);

export const sets = () => get('/sets', z.array(CardSetSchema));

export const searchCards = (params: CardSearchParams = {}) =>
  get('/cards', CardSearchResultSchema, params);
