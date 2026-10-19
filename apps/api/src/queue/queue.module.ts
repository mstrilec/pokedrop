import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { QUEUE } from './queue.constants.js';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        // Options rather than RedisService's client, deliberately: BullMQ sets
        // maxRetriesPerRequest to null on connections it constructs, and given
        // an instance it can only warn. The cache's client is configured for
        // the opposite purpose - to give up quickly and report a miss.
        connection: { url: config.redis.url, db: config.redis.queueDb },
        defaultJobOptions: config.queue.defaults,
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE.catalogSync },
      { name: QUEUE.priceSync },
      { name: QUEUE.priceSweep },
      { name: QUEUE.priceActive },
      { name: QUEUE.tradeExpiry },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
