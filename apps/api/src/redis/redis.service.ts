import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/index.js';

/**
 * Owns the single ioredis connection. BullMQ will open its own against the
 * queue database in a later ticket; this one is the cache's, and it is the only
 * place a connection is constructed.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  readonly client: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new Redis(config.redis.url, {
      db: config.redis.cacheDb,

      // Connect in onModuleInit instead of in this constructor, so that a
      // failure surfaces during Nest's startup sequence rather than as an
      // unhandled error event from a half-built module.
      lazyConnect: true,

      // No keyPrefix: see the note in cache.keys.ts. The prefix is part of the
      // key, not a client-side rewrite.
    });

    // ioredis emits 'error' on every reconnect attempt. Without a listener Node
    // treats it as an unhandled error event and terminates the process — which
    // would turn a momentary Redis blip into an outage of the whole API.
    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis connection error: ${error.message}`);
    });
  }

  /**
   * A bad REDIS_URL should stop the boot, the same way a bad DATABASE_URL does.
   * Runtime failures are treated as cache misses by CacheService — degraded but
   * serving — but a misconfiguration at startup is worth failing loudly for.
   */
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
