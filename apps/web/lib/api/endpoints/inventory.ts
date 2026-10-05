import {
  InventoryPageSchema,
  type InventoryQuerySchema,
  InventorySummarySchema,
  OwnedCountsSchema,
} from '@pokedrop/shared';
import type { z } from 'zod';
import { get } from '../core';

export type InventoryParams = z.input<typeof InventoryQuerySchema>;

export const inventory = (params: InventoryParams = {}) =>
  get('/inventory', InventoryPageSchema, params);

export const inventorySummary = () => get('/inventory/summary', InventorySummarySchema);

export const ownedCounts = (cardIds: readonly string[]) =>
  get('/inventory/owned', OwnedCountsSchema, { cardIds: cardIds.join(',') });
