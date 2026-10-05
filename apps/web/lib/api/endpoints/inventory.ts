import {
  InventoryPageSchema,
  type InventoryQuerySchema,
  InventorySummarySchema,
} from '@pokedrop/shared';
import type { z } from 'zod';
import { get } from '../core';

export type InventoryParams = z.input<typeof InventoryQuerySchema>;

export const inventory = (params: InventoryParams = {}) =>
  get('/inventory', InventoryPageSchema, params);

export const inventorySummary = () => get('/inventory/summary', InventorySummarySchema);
