import {
  type CardSearchQuerySchema,
  CardSearchResultSchema,
  CatalogFacetsSchema,
} from '@pokedrop/shared';
import type { z } from 'zod';
import { get } from '../core';

export type CardSearchParams = z.input<typeof CardSearchQuerySchema>;

export const facets = () => get('/facets', CatalogFacetsSchema);

export const searchCards = (params: CardSearchParams = {}) =>
  get('/cards', CardSearchResultSchema, params);
