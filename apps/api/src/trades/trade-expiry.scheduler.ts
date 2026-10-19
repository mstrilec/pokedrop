import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { QUEUE } from '../queue/index.js';

@Injectable()
export class TradeExpiryScheduler {
  private readonly logger = new Logger(TradeExpiryScheduler.name);

  constructor(@InjectQueue(QUEUE.tradeExpiry) private readonly queue: Queue) {}

  @Cron('15 * * * *', { name: 'trade-expiry', timeZone: 'UTC' })
  async enqueue(): Promise<void> {
    const job = await this.queue.add('trade-expiry', {});
    this.logger.log(`Enqueued trade expiry as job ${job.id}`);
  }
}
