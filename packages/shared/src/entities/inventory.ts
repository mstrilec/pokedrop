import { z } from 'zod';
import { CardSchema } from './card.js';
import { CardSearchQuerySchema } from './catalog.js';
import { CardIdSchema, InventoryItemIdSchema, UserIdSchema } from '../primitives/id.js';
import { PaginationQuerySchema, cursorPageOf } from '../primitives/pagination.js';

export const InventoryItemSchema = z.object({
  id: InventoryItemIdSchema,
  userId: UserIdSchema,
  cardId: CardIdSchema,
  quantity: z.number().int().min(0),
  lockedQuantity: z.number().int().min(0),
  availableQuantity: z.number().int().min(0),
  acquiredAt: z.coerce.date(),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const InventorySummarySchema = z.object({
  totalCards: z.number().int().min(0),
  uniqueCards: z.number().int().min(0),
  collectionValueUsd: z.number().nonnegative(),
  setCompletion: z.array(
    z.object({
      setId: z.string().min(1),
      owned: z.number().int().min(0),
      total: z.number().int().min(0),
    }),
  ),
});
export type InventorySummary = z.infer<typeof InventorySummarySchema>;

export const INVENTORY_SORTS = [
  'acquired_desc',
  'acquired_asc',
  'name_asc',
  'name_desc',
  'price_desc',
  'price_asc',
] as const;

export const InventorySortSchema = z.enum(INVENTORY_SORTS).default('acquired_desc');
export type InventorySort = z.infer<typeof InventorySortSchema>;

export const InventoryQuerySchema = CardSearchQuerySchema.pick({
  q: true,
  set: true,
  rarity: true,
  type: true,
}).extend({
  cursor: z.string().min(1).max(512).optional(),
  pageSize: PaginationQuerySchema.shape.pageSize,
  // The ceiling is PostgreSQL's integer: past it the driver fails, not the pipe.
  minQuantity: z.coerce.number().int().min(1).max(2_147_483_647).optional(),
  sort: InventorySortSchema,
});
export type InventoryQuery = z.infer<typeof InventoryQuerySchema>;

export const InventoryCardSchema = CardSchema.pick({
  id: true,
  setId: true,
  name: true,
  supertype: true,
  subtypes: true,
  types: true,
  hp: true,
  rarity: true,
  imageSmall: true,
  latestPriceUsd: true,
  latestPriceEur: true,
  priceUpdatedAt: true,
});
export type InventoryCard = z.infer<typeof InventoryCardSchema>;

export const InventoryEntrySchema = InventoryItemSchema.omit({ userId: true }).extend({
  card: InventoryCardSchema,
});
export type InventoryEntry = z.infer<typeof InventoryEntrySchema>;

export const InventoryPageSchema = cursorPageOf(InventoryEntrySchema);
export type InventoryPage = z.infer<typeof InventoryPageSchema>;
