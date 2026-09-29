import type { JobsOptions } from 'bullmq';
import { QUEUE } from './queue.constants.js';

export type DedupedSyncQueue = typeof QUEUE.catalogSync | typeof QUEUE.priceSweep;

/**
 * One key per queue, held while a job is waiting, delayed or running. The cron
 * and the admin route both enqueue through it, so neither can queue a second
 * run beside the first.
 */
export const SYNC_DEDUP_ID: Record<DedupedSyncQueue, string> = {
  [QUEUE.catalogSync]: 'catalog-sync',
  [QUEUE.priceSweep]: 'price-sweep',
};

export function syncJobOptions(queue: DedupedSyncQueue, jobId?: string): JobsOptions {
  return {
    ...(jobId === undefined ? {} : { jobId }),
    deduplication: { id: SYNC_DEDUP_ID[queue] },
  };
}
