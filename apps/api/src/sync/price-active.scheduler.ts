import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { QUEUE } from '../queue/index.js';

/**
 * Four times a day, and deliberately not `CronExpression.EVERY_6_HOURS`.
 *
 * That expression is `0,6,12,18`, which puts a run at 00:00 UTC - immediately
 * after the request budget resets and three hours BEFORE the catalog sync and
 * the nightly sweep. The whole reason the two big jobs are safe without a rule
 * protecting them is that they run first on a fresh allowance, and an active
 * run at midnight would spend ahead of them.
 *
 * 05:00, 11:00, 17:00 and 23:00 UTC are all after both nightly jobs have taken
 * their share, and none of them straddles the reset.
 *
 * Registered in the worker and not the API: two processes running this cron
 * would enqueue two runs each time.
 */
@Injectable()
export class PriceActiveScheduler {
  private readonly logger = new Logger(PriceActiveScheduler.name);

  constructor(@InjectQueue(QUEUE.priceActive) private readonly queue: Queue) {}

  /**
   * The entire body is an enqueue, per the rule in queue/README.md. Doing the
   * work here would lose every retry, backoff and failure record the queue
   * provides.
   */
  @Cron('0 5,11,17,23 * * *', { name: 'price-active', timeZone: 'UTC' })
  async enqueue(): Promise<void> {
    const job = await this.queue.add('price-active', {});
    this.logger.log(`Enqueued active price refresh as job ${job.id}`);
  }
}
