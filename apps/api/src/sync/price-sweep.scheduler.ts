import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { QUEUE } from '../queue/index.js';

/**
 * 4am, an hour after the catalog sync.
 *
 * They must not overlap. The two share a daily allowance of 1 000 requests and
 * a ceiling of 30 a minute, and the catalog sync takes 11 to 15 minutes from
 * 3am, so an hour is room enough for it to finish badly.
 *
 * Registered in the worker and not the API: two processes running this cron
 * would enqueue two sweeps a night and spend the budget twice.
 */
@Injectable()
export class PriceSweepScheduler {
  private readonly logger = new Logger(PriceSweepScheduler.name);

  constructor(@InjectQueue(QUEUE.priceSweep) private readonly queue: Queue) {}

  /**
   * The entire body is an enqueue, per the rule in queue/README.md. Doing the
   * work here would run it outside the queue and lose every retry, backoff and
   * failure record the queue provides.
   */
  // `timeZone: 'UTC'` because the request budget this run spends against is
  // keyed on the UTC day (`budget:{provider}:{YYYY-MM-DD}`). Without it, at
  // host offsets of UTC+4 or more this cron and the catalog sync's 3am cron
  // fall on different budget keys, and PRICE_SWEEP_RESERVE stops protecting a
  // shared allowance.
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'price-sweep', timeZone: 'UTC' })
  async enqueue(): Promise<void> {
    const job = await this.queue.add('price-sweep', {});
    this.logger.log(`Enqueued price sweep as job ${job.id}`);
  }
}
