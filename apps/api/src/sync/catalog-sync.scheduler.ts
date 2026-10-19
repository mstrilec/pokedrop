import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { QUEUE, SYNC_DEDUP_ID, syncJobOptions } from '../queue/index.js';

@Injectable()
export class CatalogSyncScheduler {
  private readonly logger = new Logger(CatalogSyncScheduler.name);

  constructor(@InjectQueue(QUEUE.catalogSync) private readonly queue: Queue) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'catalog-sync', timeZone: 'UTC' })
  async enqueue(): Promise<void> {
    const holder = await this.queue.getDeduplicationJobId(SYNC_DEDUP_ID[QUEUE.catalogSync]);
    if (holder !== null) {
      this.logger.warn(`Skipped the catalog sync: job ${holder} is still queued or running`);
      return;
    }
    const job = await this.queue.add('catalog-sync', {}, syncJobOptions(QUEUE.catalogSync));
    this.logger.log(`Enqueued catalog sync as job ${job.id}`);
  }
}
