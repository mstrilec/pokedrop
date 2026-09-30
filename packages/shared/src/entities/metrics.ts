import { z } from 'zod';
import { QueueDepthSchema, SyncRunSummarySchema } from './sync.js';

const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Count = z.number().int().min(0);

export const AdminMetricsQuerySchema = z.object({
  days: z.enum(['7', '14', '30']).default('14').transform(Number),
});
export type AdminMetricsQuery = z.infer<typeof AdminMetricsQuerySchema>;
export type MetricsWindow = AdminMetricsQuery['days'];

/**
 * One UTC day. Flat, so a chart takes any field as its dataKey. The counter
 * fields are null when Redis could not be read; a day with no traffic is 0.
 */
export const MetricsDaySchema = z.object({
  day: DaySchema,
  partial: z.boolean(),
  activeUsers: Count,
  packsOpened: Count,
  tradesProposed: Count,
  tradesAccepted: Count,
  tradesDeclined: Count,
  tradesCancelled: Count,
  tradesCountered: Count,
  tradesVoided: Count,
  requests: Count.nullable(),
  serverErrors: Count.nullable(),
  errorRate: z.number().min(0).max(1).nullable(),
  packFallbacks: Count.nullable(),
  packUnavailable: Count.nullable(),
});
export type MetricsDay = z.infer<typeof MetricsDaySchema>;

export const AdminMetricsSchema = z.object({
  generatedAt: z.coerce.date(),
  window: z.object({ days: z.number().int(), from: DaySchema, to: DaySchema }),
  series: z.array(MetricsDaySchema).nullable(),
  summary: z.object({ current: MetricsDaySchema, previous: MetricsDaySchema }).nullable(),
  freshness: z
    .object({
      oldestPriceUpdatedAt: z.coerce.date().nullable(),
      cardsWithoutPrice: Count,
      lastRuns: z.array(SyncRunSummarySchema).nullable(),
    })
    .nullable(),
  queues: z.array(QueueDepthSchema).nullable(),
});
export type AdminMetrics = z.infer<typeof AdminMetricsSchema>;
