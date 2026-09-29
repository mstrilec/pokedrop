import { z } from 'zod';
import { NotificationIdSchema, TradeIdSchema, UserIdSchema } from '../primitives/id.js';
import { PaginationQuerySchema, cursorPageOf } from '../primitives/pagination.js';
import { TRADE_NOTIFICATION_TYPES, TradePartySchema } from './trade.js';

export const NotificationSchema = z.object({
  id: NotificationIdSchema,
  userId: UserIdSchema,
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  readAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NOTIFICATION_TYPES = [...TRADE_NOTIFICATION_TYPES, 'currency.granted'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Never an actor id: who acted follows from the kind, and an admin's id is not a member's to see. */
export const TradeNotificationPayloadSchema = z.object({ tradeId: TradeIdSchema });
export type TradeNotificationPayload = z.infer<typeof TradeNotificationPayloadSchema>;

/** Signed: an admin adjustment downwards is a negative grant. */
export const CurrencyGrantedPayloadSchema = z.object({ amount: z.number().int() });
export type CurrencyGrantedPayload = z.infer<typeof CurrencyGrantedPayloadSchema>;

export const NOTIFICATION_PAYLOAD_SCHEMAS = {
  'trade.proposed': TradeNotificationPayloadSchema,
  'trade.accepted': TradeNotificationPayloadSchema,
  'trade.declined': TradeNotificationPayloadSchema,
  'trade.cancelled': TradeNotificationPayloadSchema,
  'trade.countered': TradeNotificationPayloadSchema,
  'trade.voided': TradeNotificationPayloadSchema,
  'trade.expired': TradeNotificationPayloadSchema,
  'currency.granted': CurrencyGrantedPayloadSchema,
} satisfies Record<NotificationType, z.ZodType>;

/** What a writer supplies for a kind: the schema's input, so plain ids rather than branded ones. */
export type NotificationPayload<T extends NotificationType> = z.input<
  (typeof NOTIFICATION_PAYLOAD_SCHEMAS)[T]
>;

/**
 * `payload` is the kind's schema applied to what was stored, so a key it does
 * not name never reaches a client. `counterparty` is the other side of the
 * trade a trade notification is about, read live rather than from the payload
 * so a renamed user reads correctly; null for every other kind.
 */
export const NotificationViewSchema = z.object({
  id: NotificationIdSchema,
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  counterparty: TradePartySchema.nullable(),
  readAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type NotificationView = z.infer<typeof NotificationViewSchema>;

export const NotificationListQuerySchema = z.object({
  unread: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  cursor: z.string().min(1).max(512).optional(),
  pageSize: PaginationQuerySchema.shape.pageSize,
});
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

export const NotificationPageSchema = cursorPageOf(NotificationViewSchema);
export type NotificationPage = z.infer<typeof NotificationPageSchema>;

export const UnreadCountSchema = z.object({ count: z.number().int().min(0) });
export type UnreadCount = z.infer<typeof UnreadCountSchema>;

export const MarkAllReadSchema = z.object({ updated: z.number().int().min(0) });
export type MarkAllRead = z.infer<typeof MarkAllReadSchema>;
