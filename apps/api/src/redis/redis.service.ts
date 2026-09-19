import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/index.js';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  readonly client: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new Redis(config.redis.url, {
      db: config.redis.cacheDb,

      lazyConnect: true,

      // Without this, ioredis queues commands while the server is unreachable
      // and waits for a reconnection instead of failing - so a cache read does
      // not become a miss, it hangs, and a request that should have degraded to
      // a database read stalls until something times out. Measured in PD-46 by
      // stopping the container: a GET that should have taken 10ms never
      // returned.
      //
      // Both consumers of this client want the opposite. CacheService treats a
      // failure as a miss and reads the database; the throttler storage fails
      // open and allows the request. The health probe is unaffected - it checks
      // `client.status` before issuing a command, for this same reason.
      enableOfflineQueue: false,
    });

    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis connection error: ${error.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    await this.client.ping();
    this.logger.log('Redis connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
    this.logger.log('Redis connection closed');
  }
}
