import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { QUEUE } from '../queue/index.js';

/**
 * Daily. The catalog gains a set a few times a year, so anything more frequent
 * spends a rate limit we cannot measure on data that has not changed. The job
 * is idempotent by construction, so a missed day costs nothing.
 *
 * Registered in the worker and not the API: two processes running this cron
 * would enqueue two jobs a night.
 */
@Injectable()
export class CatalogSyncScheduler {
  private readonly logger = new Logger(CatalogSyncScheduler.name);

  constructor(@InjectQueue(QUEUE.catalogSync) private readonly queue: Queue) {}

  /**
   * The entire body is an enqueue, per the rule in queue/README.md. Doing the
   * work here would run it outside the queue and lose every retry, backoff and
   * failure record the queue provides.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'catalog-sync' })
  async enqueue(): Promise<void> {
    const job = await this.queue.add('catalog-sync', {});
    this.logger.log(`Enqueued catalog sync as job ${job.id}`);
  }
}
