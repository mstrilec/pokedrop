import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { QUEUE } from '../queue/index.js';

/**
 * Not `CronExpression.EVERY_6_HOURS`: that runs at 00:00 UTC, right after the budget resets and
 * before the nightly catalog sync and sweep, and would spend ahead of them.
 */
@Injectable()
export class PriceActiveScheduler {
  private readonly logger = new Logger(PriceActiveScheduler.name);

  constructor(@InjectQueue(QUEUE.priceActive) private readonly queue: Queue) {}

  @Cron('0 5,11,17,23 * * *', { name: 'price-active', timeZone: 'UTC' })
  async enqueue(): Promise<void> {
    const job = await this.queue.add('price-active', {});
    this.logger.log(`Enqueued active price refresh as job ${job.id}`);
  }
}
