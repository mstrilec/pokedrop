import { z } from 'zod';

/**
 * Branded identifiers.
 *
 * Every id is a string at runtime, but branding makes them distinct types, so
 * passing a userId where a cardId belongs is a compile error rather than a
 * lookup that silently returns nothing. Trades are the motivating case: a
 * TradeItem carries tradeId, cardId and userId side by side.
 *
 * The base is a non-empty string rather than a uuid on purpose. Catalog ids
 * come from pokemontcg.io in forms like `base1-4`, and the shape of our own
 * ids is not settled until the Prisma schema lands in PD-22.
 *
 * The brand is a type argument only — it has no runtime representation.
 */
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
