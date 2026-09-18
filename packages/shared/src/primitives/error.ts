import { z } from 'zod';

export const ErrorEnvelopeSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  requestId: z.string(),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
