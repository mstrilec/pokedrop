import { z } from 'zod';
import { CardIdSchema, InventoryItemIdSchema, UserIdSchema } from '../primitives/id.js';

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
