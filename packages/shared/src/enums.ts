import { z } from 'zod';

export const RoleSchema = z.enum(['MEMBER', 'ADMIN']);
export type Role = z.infer<typeof RoleSchema>;

export const RaritySchema = z.string().min(1);
export type Rarity = z.infer<typeof RaritySchema>;

export const RarityTierSchema = z.enum(['Common', 'Uncommon', 'Rare', 'Ultra Rare', 'Secret Rare']);
export type RarityTier = z.infer<typeof RarityTierSchema>;

export const TradeStatusSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'COUNTERED',
  'CANCELLED',
  'VOIDED',
]);
export type TradeStatus = z.infer<typeof TradeStatusSchema>;

export const TradeItemSideSchema = z.enum(['OFFERED', 'REQUESTED']);
export type TradeItemSide = z.infer<typeof TradeItemSideSchema>;

export const PriceSourceSchema = z.enum(['TCGPLAYER', 'CARDMARKET']);
export type PriceSource = z.infer<typeof PriceSourceSchema>;

export const TransactionTypeSchema = z.enum(['GRANT', 'PACK_SPEND', 'TRADE']);
export type TransactionType = z.infer<typeof TransactionTypeSchema>;

export const SyncKindSchema = z.enum(['CATALOG', 'PRICE', 'PRICE_ACTIVE']);
export type SyncKind = z.infer<typeof SyncKindSchema>;

export const SyncStatusSchema = z.enum(['RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED']);
export type SyncStatus = z.infer<typeof SyncStatusSchema>;
