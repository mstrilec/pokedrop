import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { HealthCheckAttempt } from '@nestjs/terminus';
import { RedisService } from '../redis/index.js';

/**
 * Terminus ships indicators for several databases but none for a plain ioredis
 * client, so this is the whole thing: ask Redis to say PONG.
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly redis: RedisService,
  ) {}

  pingCheck<Key extends string>(key: Key, timeoutMs: number): HealthCheckAttempt<Key> {
    return this.healthIndicatorService
      .check(key)
      .attempt(async () => {
        // Checked before pinging because ioredis keeps `enableOfflineQueue` on
        // by default: with the server down, `ping()` does not reject, it joins
        // a queue and waits for a reconnection that may never come. The status
        // check turns that silent hang into an immediate, named failure, and
        // the timeout below is only the backstop.
        const { status } = this.redis.client;

        if (status !== 'ready') {
          throw new Error(`Redis connection is ${status}`);
        }

        await this.redis.client.ping();
      })
      .withTimeout(timeoutMs);
  }
}
