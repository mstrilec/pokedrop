import { z } from 'zod';
import { TransactionTypeSchema } from '../enums.js';
import {
  CurrencyTransactionIdSchema,
  PackOpeningIdSchema,
  TradeIdSchema,
  UserIdSchema,
} from '../primitives/id.js';
import { PaginationQuerySchema, cursorPageOf } from '../primitives/pagination.js';
import { TradePartySchema } from './trade.js';

export const CurrencyTransactionSchema = z.object({
  id: CurrencyTransactionIdSchema,
  userId: UserIdSchema,
  amount: z.number().int(),
  type: TransactionTypeSchema,
  refId: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type CurrencyTransaction = z.infer<typeof CurrencyTransactionSchema>;

/** `TRADE` also matches `TRADE_REVERSAL`: a void is part of the trade's story. */
export const WALLET_FILTERS = ['GRANT', 'PACK_SPEND', 'TRADE'] as const;

export const WalletQuerySchema = z.object({
  type: z.enum(WALLET_FILTERS).optional(),
  cursor: z.string().min(1).max(512).optional(),
  pageSize: PaginationQuerySchema.shape.pageSize,
});
export type WalletQuery = z.infer<typeof WalletQuerySchema>;

/** What caused a ledger row. Null when its reference no longer resolves. */
export const WalletSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('welcome') }),
  z.object({ kind: z.literal('grant') }),
  z.object({
    kind: z.literal('pack'),
    openingId: PackOpeningIdSchema,
    templateName: z.string(),
  }),
  z.object({ kind: z.literal('trade'), tradeId: TradeIdSchema, counterparty: TradePartySchema }),
]);
export type WalletSource = z.infer<typeof WalletSourceSchema>;

/** `balanceAfter` is the ledger's running total up to and including this row, whatever the filter. */
export const WalletEntrySchema = z.object({
  id: CurrencyTransactionIdSchema,
  type: TransactionTypeSchema,
  amount: z.number().int(),
  balanceAfter: z.number().int(),
  source: WalletSourceSchema.nullable(),
  createdAt: z.coerce.date(),
});
export type WalletEntry = z.infer<typeof WalletEntrySchema>;

export const WalletPageSchema = cursorPageOf(WalletEntrySchema).extend({
  balance: z.number().int(),
});
export type WalletPage = z.infer<typeof WalletPageSchema>;
