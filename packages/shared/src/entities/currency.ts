import { z } from 'zod';
import { TransactionTypeSchema } from '../enums.js';
import { CurrencyTransactionIdSchema, UserIdSchema } from '../primitives/id.js';

/**
 * The audit trail behind every balance.
 *
 * `amount` is signed: a GRANT is positive, a PACK_SPEND negative. The balance
 * on User must always equal the sum of these rows, which is the invariant the
 * transactional work in PD-58 and PD-70 has to preserve.
 */
export const CurrencyTransactionSchema = z.object({
  id: CurrencyTransactionIdSchema,
  userId: UserIdSchema,
  amount: z.number().int(),
  type: TransactionTypeSchema,
  refId: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type CurrencyTransaction = z.infer<typeof CurrencyTransactionSchema>;
