import { Injectable } from '@nestjs/common';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { RedisService } from '../redis/index.js';
import { probe } from './probe.js';

@Injectable()
export class RedisHealthIndicator {
  constructor(private readonly redis: RedisService) {}

  pingCheck<Key extends string>(key: Key, timeoutMs: number): Promise<HealthIndicatorResult<Key>> {
    return probe(
      key,
      async () => {
        // Check status before pinging: ioredis keeps enableOfflineQueue on, so
        // with the server down ping() does not reject - it queues and waits for
        // a reconnection, and the probe would hang to its timeout.
        const { status } = this.redis.client;

        if (status !== 'ready') {
          throw new Error(`Redis connection is ${status}`);
        }

        await this.redis.client.ping();
      },
      timeoutMs,
    );
  }
}
