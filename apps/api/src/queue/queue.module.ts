import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { QUEUE } from './queue.constants.js';

/**
 * Imported by both entrypoints, and the difference between them is not in this
 * file: `registerQueue` creates producers, while a `@Processor` class creates a
 * worker. The API imports this module and declares no processor, so it can
 * enqueue and never consumes.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        // `url` is BullMQ's own field, added on top of ioredis' RedisOptions -
        // ioredis takes a URL as a constructor argument and has no such option,
        // so reading its types alone suggests this cannot work.
        //
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
      { name: QUEUE.tradeExpiry },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
