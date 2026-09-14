import { z } from 'zod';

export const RoleSchema = z.enum(['MEMBER', 'ADMIN']);
export type Role = z.infer<typeof RoleSchema>;

/**
 * Rarity as printed on the card, taken verbatim from the provider.
 *
 * Deliberately a string and not an enum. docs/DataModel.md calls the list
 * extensible, and it is: every new set can introduce a rarity nobody has seen.
 * A closed enum here would mean the next release breaks catalog sync.
 */
export const RaritySchema = z.string().min(1);
export type Rarity = z.infer<typeof RaritySchema>;

/**
 * The closed ramp the UI actually renders. Arbitrary provider rarities are
 * mapped onto these five tiers for colour, sorting and filters.
 */
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
