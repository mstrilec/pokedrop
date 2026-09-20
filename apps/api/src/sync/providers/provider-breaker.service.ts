import { Injectable, Logger } from '@nestjs/common';
import { RedisService, breakerKeys } from '../../redis/index.js';
import type { CardSourceName } from './card-source-provider.js';

/**
 * Five consecutive escaped failures.
 *
 * Measured across four real sweeps against the primary: 3 failed pages out of
 * 83, scattered rather than clustered. At that rate five in a row is an event of
 * roughly 6e-8, so the threshold measures an outage rather than a bad night.
 * Consecutive is what makes that true - the counter resets on any success.
 */
const FAILURE_THRESHOLD = 5;

/** Thirty minutes, expressed as the open key's TTL. Nothing schedules a
 * re-test and nothing has to: the key expires, and the next run's selector
 * sees a closed breaker. */
const COOLDOWN_SECONDS = 1_800;

/**
 * The counter's own TTL. Without it, four failures from a run last Tuesday
 * would still be sitting there when a fifth arrives today, and "consecutive"
 * would quietly come to mean "five, ever".
 */
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

  /**
   * Counts one escaped failure and returns the new count.
   *
   * Only ProviderUnavailableError and ProviderContractError reach here. A
   * ProviderRateLimitError must not: a 429 means the upstream is healthy and we
   * are asking too fast, and counting it moves the load onto the fallback and
   * rate-limits that one too.
   */
  async recordFailure(provider: CardSourceName): Promise<number> {
    try {
      const key = breakerKeys.failures(provider);
      const failures = await this.redis.client.incr(key);
      await this.redis.client.expire(key, FAILURE_WINDOW_SECONDS);

      if (failures >= FAILURE_THRESHOLD) {
        await this.redis.client.set(breakerKeys.open(provider), '1', 'EX', COOLDOWN_SECONDS);
        this.logger.warn(
          `Breaker OPEN for ${provider} after ${failures} consecutive failures; ` +
            `the next run will use a fallback until it expires in ${COOLDOWN_SECONDS}s`,
        );
      }

      return failures;
    } catch (error) {
      // Logged loudly rather than swallowed. A breaker that cannot count is a
      // breaker that will not trip, and an operator reading these logs during an
      // outage needs to know that is why.
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

  /**
   * Fails closed toward the primary, not toward the fallback: with Redis
   * unreachable this returns false, so the selector keeps the configured
   * provider. Switching sources on the strength of a Redis outage would be
   * acting on no evidence at all.
   */
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
        // -2 is "no such key" and -1 is "no expiry"; only a positive TTL is an
        // open breaker with time left on it.
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
