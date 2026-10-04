import {
  type CardSearchQuerySchema,
  CardSearchResultSchema,
  CardSetSchema,
  CatalogFacetsSchema,
} from '@pokedrop/shared';
import { z } from 'zod';
import { get } from '../core';

export type CardSearchParams = z.input<typeof CardSearchQuerySchema>;

export const facets = () => get('/facets', CatalogFacetsSchema);

export const sets = () => get('/sets', z.array(CardSetSchema));

export const searchCards = (params: CardSearchParams = {}) =>
  get('/cards', CardSearchResultSchema, params);
