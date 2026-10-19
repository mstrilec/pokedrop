import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { QUEUE, SYNC_DEDUP_ID, syncJobOptions } from '../queue/index.js';

@Injectable()
export class PriceSweepScheduler {
  private readonly logger = new Logger(PriceSweepScheduler.name);

  constructor(@InjectQueue(QUEUE.priceSweep) private readonly queue: Queue) {}

  // `timeZone: 'UTC'`: the budget is keyed on the UTC day, and on a host far from UTC this cron
  // and the catalog sync's would land on different budget keys.
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'price-sweep', timeZone: 'UTC' })
  async enqueue(): Promise<void> {
    const holder = await this.queue.getDeduplicationJobId(SYNC_DEDUP_ID[QUEUE.priceSweep]);
    if (holder !== null) {
      this.logger.warn(`Skipped the price sweep: job ${holder} is still queued or running`);
      return;
    }
    const job = await this.queue.add('price-sweep', {}, syncJobOptions(QUEUE.priceSweep));
    this.logger.log(`Enqueued price sweep as job ${job.id}`);
  }
}
