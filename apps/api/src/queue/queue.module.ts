import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { QUEUE } from './queue.constants.js';

/**
 * Imported by both entrypoints. `registerQueue` creates producers, while a
 * `@Processor` class creates a worker — and the API is both: `AppModule` also
 * imports `SyncModule`, which declares all four processors, so the API process
 * consumes every queue it enqueues to. What actually splits the two entrypoints
 * is the scheduler, since `ScheduleModule.forRoot()` lives only in
 * `WorkerModule`. See `queue/README.md` for the full account.
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
      { name: QUEUE.priceActive },
      { name: QUEUE.tradeExpiry },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
