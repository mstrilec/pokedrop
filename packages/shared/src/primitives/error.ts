import { z } from 'zod';

/**
 * Stable machine-readable codes for domain errors. `message` is prose and may
 * change; clients branch on `code`.
 */
export const ERROR_CODES = {
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  PACK_UNAVAILABLE: 'PACK_UNAVAILABLE',
  OPEN_ID_CONFLICT: 'OPEN_ID_CONFLICT',
  CARDS_UNAVAILABLE: 'CARDS_UNAVAILABLE',
  TRADE_NOT_PENDING: 'TRADE_NOT_PENDING',
  COUNTER_LIMIT: 'COUNTER_LIMIT',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ErrorEnvelopeSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  code: z.string().optional(),
  requestId: z.string(),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
