import type { JobsOptions } from 'bullmq';
import { QUEUE } from './queue.constants.js';

export type DedupedSyncQueue = typeof QUEUE.catalogSync | typeof QUEUE.priceSweep;

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
