import { InventoryQuerySchema, type InventorySort } from '@pokedrop/shared';
import { z } from 'zod';

export const InventoryUrlSchema = InventoryQuerySchema.pick({
  q: true,
  set: true,
  rarity: true,
  type: true,
  minQuantity: true,
  sort: true,
}).extend({ view: z.enum(['grid', 'list']).optional() });

export type View = 'grid' | 'list';

export const SORT_LABELS: Record<InventorySort, string> = {
  acquired_desc: 'Recently acquired',
  acquired_asc: 'Oldest first',
  name_asc: 'Name A–Z',
  name_desc: 'Name Z–A',
  price_desc: 'Price high–low',
  price_asc: 'Price low–high',
};

const VIEW_KEY = 'pokedrop.inventory-view';

export function storedView(): View | null {
  try {
    const value = localStorage.getItem(VIEW_KEY);
    return value === 'grid' || value === 'list' ? value : null;
  } catch {
    return null;
  }
}

export function storeView(view: View): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // A refused storage only forgets the choice.
  }
}
