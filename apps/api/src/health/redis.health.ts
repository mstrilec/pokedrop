import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { HealthCheckAttempt } from '@nestjs/terminus';
import { RedisService } from '../redis/index.js';

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
        // Check status before pinging: ioredis keeps enableOfflineQueue on, so
        // with the server down ping() does not reject - it queues and waits for
        // a reconnection, and the probe would hang to its timeout.
        const { status } = this.redis.client;

        if (status !== 'ready') {
          throw new Error(`Redis connection is ${status}`);
        }

        await this.redis.client.ping();
      })
      .withTimeout(timeoutMs);
  }
}
