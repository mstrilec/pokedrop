import { z } from 'zod';
import { SyncKindSchema, SyncStatusSchema } from '../enums.js';

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
