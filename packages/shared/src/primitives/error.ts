import { z } from 'zod';

/**
 * The standard error envelope from docs/API.md.
 *
 * `message` is a single string, matching the document. Zod validation produces
 * several issues at once, so the global exception filter in PD-18 decides
 * whether to join them or widen this shape; until then the contract says what
 * the specification says.
 */
export const ErrorEnvelopeSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  requestId: z.string(),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
