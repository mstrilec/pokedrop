import { z } from 'zod';
import { TradeItemSideSchema, TradeStatusSchema } from '../enums.js';
import { CardIdSchema, TradeIdSchema, TradeItemIdSchema, UserIdSchema } from '../primitives/id.js';

export const TradeItemSchema = z.object({
  id: TradeItemIdSchema,
  tradeId: TradeIdSchema,
  side: TradeItemSideSchema,
  cardId: CardIdSchema,
  quantity: z.number().int().min(1),
});
export type TradeItem = z.infer<typeof TradeItemSchema>;

export const TradeSchema = z.object({
  id: TradeIdSchema,
  initiatorId: UserIdSchema,
  recipientId: UserIdSchema,
  status: TradeStatusSchema,
  currencyFromInitiator: z.number().int().min(0),
  currencyFromRecipient: z.number().int().min(0),
  items: z.array(TradeItemSchema),
  createdAt: z.coerce.date(),
  resolvedAt: z.coerce.date().nullable(),
});
export type Trade = z.infer<typeof TradeSchema>;
