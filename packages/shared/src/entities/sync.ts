import { z } from 'zod';
import { SyncKindSchema, SyncStatusSchema } from '../enums.js';

/**
 * `provider` is a free string rather than an enum, matching the column. A closed
 * enum would need a migration every time a provider is added - the coupling the
 * CardSourceProvider adapter removes.
 *
 * `stale` is true for a RUNNING row whose job is gone or finished, null when
 * the queue could not be read, and false for every closed run.
 */
export const SyncRunSummarySchema = z.object({
  kind: SyncKindSchema,
  provider: z.string().min(1),
  status: SyncStatusSchema,
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
  durationMs: z.number().int().min(0).nullable(),
  processed: z.number().int().min(0),
  failed: z.number().int().min(0),
  error: z.string().nullable(),
  jobId: z.string().nullable(),
  stale: z.boolean().nullable(),
});
export type SyncRunSummary = z.infer<typeof SyncRunSummarySchema>;

/**
 * `openUntil` is when the cooldown expires, not when it opened: it answers
 * "when will the primary be tried again", which is the question being asked.
 */
export const ProviderBreakerStateSchema = z.object({
  provider: z.string().min(1),
  failures: z.number().int().min(0),
  openUntil: z.coerce.date().nullable(),
});
export type ProviderBreakerStateDto = z.infer<typeof ProviderBreakerStateSchema>;

export const QueueDepthSchema = z.object({
  queue: z.string().min(1),
  waiting: z.number().int().min(0),
  active: z.number().int().min(0),
  delayed: z.number().int().min(0),
  failed: z.number().int().min(0),
});
export type QueueDepth = z.infer<typeof QueueDepthSchema>;

/** Each section is null when it could not be read and [] when it is empty. */
export const SyncStatusResponseSchema = z.object({
  runs: z.array(SyncRunSummarySchema).nullable(),
  queues: z.array(QueueDepthSchema).nullable(),
  breakers: z.array(ProviderBreakerStateSchema).nullable(),
  primaryProvider: z.string().min(1),
  nextProvider: z.string().min(1).nullable(),
});
export type SyncStatusResponse = z.infer<typeof SyncStatusResponseSchema>;

export const SyncTriggerKindSchema = z.enum(['CATALOG', 'PRICE']);
export type SyncTriggerKind = z.infer<typeof SyncTriggerKindSchema>;

export const SyncTriggerResultSchema = z.object({
  jobId: z.string().min(1),
  kind: SyncTriggerKindSchema,
});
export type SyncTriggerResult = z.infer<typeof SyncTriggerResultSchema>;
