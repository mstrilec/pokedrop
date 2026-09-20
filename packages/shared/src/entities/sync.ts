import { z } from 'zod';
import { SyncKindSchema, SyncStatusSchema } from '../enums.js';

/**
 * `provider` is a free string rather than an enum, matching the column. A closed
 * enum would need a migration every time a provider is added, which is exactly
 * the coupling the CardSourceProvider adapter removes - docs/DataModel.md says
 * so on the model itself.
 */
export const SyncRunSummarySchema = z.object({
  kind: SyncKindSchema,
  provider: z.string().min(1),
  status: SyncStatusSchema,
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
  processed: z.number().int().min(0),
  failed: z.number().int().min(0),
  error: z.string().nullable(),
});
export type SyncRunSummary = z.infer<typeof SyncRunSummarySchema>;

/**
 * `openUntil` is when the cooldown expires, not when it opened. It is the only
 * one of the two an operator can act on: it answers "when will the primary be
 * tried again", which is the question being asked.
 */
export const ProviderBreakerStateSchema = z.object({
  provider: z.string().min(1),
  failures: z.number().int().min(0),
  openUntil: z.coerce.date().nullable(),
});
export type ProviderBreakerStateDto = z.infer<typeof ProviderBreakerStateSchema>;

export const SyncStatusResponseSchema = z.object({
  runs: z.array(SyncRunSummarySchema),
  breakers: z.array(ProviderBreakerStateSchema),
});
export type SyncStatusResponse = z.infer<typeof SyncStatusResponseSchema>;
