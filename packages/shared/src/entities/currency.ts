import { z } from 'zod';
import { TransactionTypeSchema } from '../enums.js';
import { CurrencyTransactionIdSchema, UserIdSchema } from '../primitives/id.js';

export const CurrencyTransactionSchema = z.object({
  id: CurrencyTransactionIdSchema,
  userId: UserIdSchema,
  amount: z.number().int(),
  type: TransactionTypeSchema,
  refId: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type CurrencyTransaction = z.infer<typeof CurrencyTransactionSchema>;
