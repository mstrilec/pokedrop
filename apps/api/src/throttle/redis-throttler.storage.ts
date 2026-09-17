import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { RedisService, throttleKeys } from '../redis/index.js';

/**
 * Counter and block in one round trip, atomically.
 *
 * INCR followed by a separate PEXPIRE has a window between the two commands. A
 * process that dies there, or a failover, leaves a counter with no expiry — and
 * a counter that never resets is a permanent ban with nothing to explain it.
 * The `ttl < 0` branch also repairs such a key if one is ever found, so a
 * counter orphaned by some other means heals on its next hit instead of
 * lasting forever.
 *
 * Returns: { totalHits, ttlMilliseconds, isBlocked, blockTtlMilliseconds }.
 */
const THROTTLE_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return { tonumber(ARGV[2]) + 1, 0, 1, blockTtl }
end

local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end

if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
  return { hits, 0, 1, tonumber(ARGV[3]) }
end

return { hits, ttl, 0, 0 }
`;

const COMMAND = 'pokedropThrottle';

type ThrottleResult = [totalHits: number, ttlMs: number, blocked: number, blockTtlMs: number];

/**
 * Derived rather than imported. `@nestjs/throttler`'s index re-exports the
 * storage interface but not the record interface, so the only stable way to
 * name the return shape is through the interface that is exported — the same
 * trick, for the same reason, as `AuthContext` in common/request-auth.ts.
 */
type StorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * ioredis attaches custom commands to the client at runtime, so the type has to
 * be widened at the call site. A local intersection rather than a global
 * `declare module` for the same reason request-auth.ts avoids one: a global
 * augmentation is owned by whoever declares it first and collides with everyone
 * after.
 */
type RedisWithThrottle = Redis & {
  [COMMAND]: (
    counterKey: string,
    blockKey: string,
    ttlMs: string,
    limit: string,
    blockMs: string,
  ) => Promise<ThrottleResult>;
};

const MS_PER_SECOND = 1000;

/**
 * The throttler's own units are asymmetric: `ttl` and `blockDuration` arrive in
 * milliseconds, while `timeToExpire` and `timeToBlockExpire` are read as
 * seconds. Every conversion happens in this file so no caller has to remember.
 */
const toSeconds = (milliseconds: number): number => Math.ceil(milliseconds / MS_PER_SECOND);

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  private readonly client: RedisWithThrottle;

  constructor(redis: RedisService) {
    // defineCommand registers the script once and uses EVALSHA per call, so the
    // script body is not resent on every request.
    redis.client.defineCommand(COMMAND, { numberOfKeys: 2, lua: THROTTLE_SCRIPT });
    this.client = redis.client as RedisWithThrottle;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<StorageRecord> {
    const namespaced = `${throttlerName}:${key}`;

    try {
      const [totalHits, ttlMs, blocked, blockTtlMs] = await this.client[COMMAND](
        throttleKeys.counter(namespaced),
        throttleKeys.block(namespaced),
        String(ttl),
        String(limit),
        String(blockDuration),
      );

      return {
        totalHits,
        timeToExpire: toSeconds(ttlMs),
        isBlocked: blocked === 1,
        timeToBlockExpire: toSeconds(blockTtlMs),
      };
    } catch (error) {
      // Fail open, deliberately. A limiter is an abuse mitigation, not an access
      // control — SessionGuard and RolesGuard read Postgres and are unaffected.
      // Failing closed would make Redis a single point of failure for the whole
      // API, so a brief cache-tier blip would take down sign-in, pack opening
      // and trading at once. CacheService made the same call for the same
      // reason. The cost is real and is documented: while Redis is down there
      // are no limits.
      this.logger.warn(
        `Rate limit check failed, allowing the request: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return {
        totalHits: 1,
        timeToExpire: toSeconds(ttl),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
