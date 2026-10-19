import { Injectable, Logger } from '@nestjs/common';
import { RedisService, breakerKeys } from '../../redis/index.js';
import type { CardSourceName } from './card-source-provider.js';

const FAILURE_THRESHOLD = 5;

const COOLDOWN_SECONDS = 1_800;

const FAILURE_WINDOW_SECONDS = 3_600;

export interface BreakerState {
  provider: CardSourceName;
  failures: number;
  openUntil: Date | null;
}

@Injectable()
export class ProviderBreakerService {
  private readonly logger = new Logger(ProviderBreakerService.name);

  constructor(private readonly redis: RedisService) {}

  async recordFailure(provider: CardSourceName): Promise<number> {
    try {
      // Pipelined into one round trip rather than two calls: a crash between
      // an incr and a separate expire would leave a counter with no TTL, and
      // "consecutive" would quietly become "ever" - the exact failure
      // FAILURE_WINDOW_SECONDS exists to prevent.
      const key = breakerKeys.failures(provider);
      const [incremented] = (await this.redis.client
        .multi()
        .incr(key)
        .expire(key, FAILURE_WINDOW_SECONDS)
        .exec()) as [[Error | null, number], [Error | null, number]];

      const failures = incremented[1];

      if (failures >= FAILURE_THRESHOLD) {
        await this.redis.client.set(breakerKeys.open(provider), '1', 'EX', COOLDOWN_SECONDS);
        this.logger.warn(
          `Breaker OPEN for ${provider} after ${failures} consecutive failures; ` +
            `the next run will use a fallback until it expires in ${COOLDOWN_SECONDS}s`,
        );
      }

      return failures;
    } catch (error) {
      this.logger.error(`Could not record a failure for ${provider}: ${describe(error)}`);
      return 0;
    }
  }

  async recordSuccess(provider: CardSourceName): Promise<void> {
    try {
      await this.redis.client.del(breakerKeys.failures(provider));
    } catch (error) {
      this.logger.warn(`Could not reset the failure count for ${provider}: ${describe(error)}`);
    }
  }

  async isOpen(provider: CardSourceName): Promise<boolean> {
    try {
      return (await this.redis.client.exists(breakerKeys.open(provider))) === 1;
    } catch (error) {
      this.logger.warn(`Could not read the breaker for ${provider}: ${describe(error)}`);
      return false;
    }
  }

  async stateOf(provider: CardSourceName): Promise<BreakerState> {
    try {
      const [raw, ttl] = await Promise.all([
        this.redis.client.get(breakerKeys.failures(provider)),
        this.redis.client.ttl(breakerKeys.open(provider)),
      ]);

      const failures = raw === null ? 0 : Number(raw);

      return {
        provider,
        failures: Number.isFinite(failures) ? failures : 0,
        openUntil: ttl > 0 ? new Date(Date.now() + ttl * 1_000) : null,
      };
    } catch (error) {
      this.logger.warn(`Could not read breaker state for ${provider}: ${describe(error)}`);
      return { provider, failures: 0, openUntil: null };
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
