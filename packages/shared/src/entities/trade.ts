import { z } from 'zod';
import { TradeItemSideSchema, TradeStatusSchema } from '../enums.js';
import { CardIdSchema, TradeIdSchema, TradeItemIdSchema, UserIdSchema } from '../primitives/id.js';
import { PaginationQuerySchema, cursorPageOf } from '../primitives/pagination.js';
import { InventoryCardSchema } from './inventory.js';

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
  counteredTradeId: TradeIdSchema.nullable(),
  items: z.array(TradeItemSchema),
  createdAt: z.coerce.date(),
  resolvedAt: z.coerce.date().nullable(),
});
export type Trade = z.infer<typeof TradeSchema>;

export const MAX_TRADE_LINES = 20;
export const MAX_TRADE_LINE_QUANTITY = 100;
export const MAX_TRADE_CURRENCY = 1_000_000;
export const MAX_COUNTER_CHAIN = 10;

export const TradeLineSchema = z.strictObject({
  cardId: CardIdSchema,
  quantity: z.number().int().min(1).max(MAX_TRADE_LINE_QUANTITY),
});
export type TradeLine = z.infer<typeof TradeLineSchema>;

const TRADE_TERMS = {
  offered: z.array(TradeLineSchema).max(MAX_TRADE_LINES).default([]),
  requested: z.array(TradeLineSchema).max(MAX_TRADE_LINES).default([]),
  currencyFromInitiator: z.number().int().min(0).max(MAX_TRADE_CURRENCY).default(0),
  currencyFromRecipient: z.number().int().min(0).max(MAX_TRADE_CURRENCY).default(0),
};

type Terms = {
  offered: TradeLine[];
  requested: TradeLine[];
  currencyFromInitiator: number;
  currencyFromRecipient: number;
};

function checkTerms(terms: Terms, ctx: z.RefinementCtx): void {
  const lines = terms.offered.length + terms.requested.length;
  if (lines === 0 && terms.currencyFromInitiator === 0 && terms.currencyFromRecipient === 0) {
    ctx.addIssue({ code: 'custom', message: 'A trade must move at least one card or coin' });
  }

  const offered = new Set(terms.offered.map((line) => line.cardId));
  const requested = new Set(terms.requested.map((line) => line.cardId));
  if (offered.size !== terms.offered.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['offered'],
      message: 'A card may appear once per side; put its copies in quantity',
    });
  }
  if (requested.size !== terms.requested.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['requested'],
      message: 'A card may appear once per side; put its copies in quantity',
    });
  }
  if ([...offered].some((cardId) => requested.has(cardId))) {
    ctx.addIssue({
      code: 'custom',
      path: ['requested'],
      message: 'A card cannot be both offered and requested',
    });
  }
}

export const CounterTradeSchema = z.strictObject(TRADE_TERMS).superRefine(checkTerms);
export type CounterTrade = z.infer<typeof CounterTradeSchema>;

export const ProposeTradeSchema = z
  .strictObject({ recipientId: UserIdSchema, ...TRADE_TERMS })
  .superRefine(checkTerms);
export type ProposeTrade = z.infer<typeof ProposeTradeSchema>;

export const VoidTradeSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});
export type VoidTrade = z.infer<typeof VoidTradeSchema>;

export const TRADE_NOTIFICATION_TYPES = [
  'trade.proposed',
  'trade.accepted',
  'trade.declined',
  'trade.cancelled',
  'trade.countered',
  'trade.voided',
  'trade.expired',
] as const;
export type TradeNotificationType = (typeof TRADE_NOTIFICATION_TYPES)[number];

export const TRADE_TABS = ['all', 'incoming', 'sent', 'completed'] as const;
export const TradeTabSchema = z.enum(TRADE_TABS);
export type TradeTab = z.infer<typeof TradeTabSchema>;

export const TradeInboxQuerySchema = z.object({
  tab: TradeTabSchema.default('all'),
  cursor: z.string().min(1).max(512).optional(),
  pageSize: PaginationQuerySchema.shape.pageSize,
});
export type TradeInboxQuery = z.infer<typeof TradeInboxQuerySchema>;

export const TradePartySchema = z.object({
  id: UserIdSchema,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type TradeParty = z.infer<typeof TradePartySchema>;

export const TradeViewItemSchema = TradeItemSchema.omit({ tradeId: true }).extend({
  card: InventoryCardSchema,
});
export type TradeViewItem = z.infer<typeof TradeViewItemSchema>;

/** `role` is the caller's side of the trade; null when an admin reads it. */
export const TradeViewSchema = TradeSchema.omit({
  initiatorId: true,
  recipientId: true,
  items: true,
}).extend({
  initiator: TradePartySchema,
  recipient: TradePartySchema,
  role: z.enum(['initiator', 'recipient']).nullable(),
  items: z.array(TradeViewItemSchema),
});
export type TradeView = z.infer<typeof TradeViewSchema>;

export const TradePageSchema = cursorPageOf(TradeViewSchema);
export type TradePage = z.infer<typeof TradePageSchema>;

/** Who acted, as a side of the trade rather than a user id. */
export const TRADE_ACTORS = ['initiator', 'recipient', 'admin', 'system'] as const;

export const TradeTimelineEntrySchema = z.object({
  action: z.string(),
  status: TradeStatusSchema,
  at: z.coerce.date(),
  by: z.enum(TRADE_ACTORS),
});
export type TradeTimelineEntry = z.infer<typeof TradeTimelineEntrySchema>;

export const TradeChainEntrySchema = z.object({
  id: TradeIdSchema,
  status: TradeStatusSchema,
  createdAt: z.coerce.date(),
  resolvedAt: z.coerce.date().nullable(),
});
export type TradeChainEntry = z.infer<typeof TradeChainEntrySchema>;

/** `chain` runs oldest first and includes this trade. */
export const TradeDetailSchema = TradeViewSchema.extend({
  timeline: z.array(TradeTimelineEntrySchema),
  chain: z.array(TradeChainEntrySchema),
});
export type TradeDetail = z.infer<typeof TradeDetailSchema>;
