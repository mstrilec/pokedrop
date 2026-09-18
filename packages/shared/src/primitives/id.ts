import { z } from 'zod';

const brandedId = <B extends string>() => z.string().min(1).brand<B>();

export const UserIdSchema = brandedId<'UserId'>();
export const SetIdSchema = brandedId<'SetId'>();
export const CardIdSchema = brandedId<'CardId'>();
export const PriceSnapshotIdSchema = brandedId<'PriceSnapshotId'>();
export const InventoryItemIdSchema = brandedId<'InventoryItemId'>();
export const PackTemplateIdSchema = brandedId<'PackTemplateId'>();
export const PackOpeningIdSchema = brandedId<'PackOpeningId'>();
export const DeckIdSchema = brandedId<'DeckId'>();
export const DeckCardIdSchema = brandedId<'DeckCardId'>();
export const TradeIdSchema = brandedId<'TradeId'>();
export const TradeItemIdSchema = brandedId<'TradeItemId'>();
export const CurrencyTransactionIdSchema = brandedId<'CurrencyTransactionId'>();
export const AuditLogIdSchema = brandedId<'AuditLogId'>();
export const NotificationIdSchema = brandedId<'NotificationId'>();

export type UserId = z.infer<typeof UserIdSchema>;
export type SetId = z.infer<typeof SetIdSchema>;
export type CardId = z.infer<typeof CardIdSchema>;
export type PriceSnapshotId = z.infer<typeof PriceSnapshotIdSchema>;
export type InventoryItemId = z.infer<typeof InventoryItemIdSchema>;
export type PackTemplateId = z.infer<typeof PackTemplateIdSchema>;
export type PackOpeningId = z.infer<typeof PackOpeningIdSchema>;
export type DeckId = z.infer<typeof DeckIdSchema>;
export type DeckCardId = z.infer<typeof DeckCardIdSchema>;
export type TradeId = z.infer<typeof TradeIdSchema>;
export type TradeItemId = z.infer<typeof TradeItemIdSchema>;
export type CurrencyTransactionId = z.infer<typeof CurrencyTransactionIdSchema>;
export type AuditLogId = z.infer<typeof AuditLogIdSchema>;
export type NotificationId = z.infer<typeof NotificationIdSchema>;
