import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { RedisService, throttleKeys } from '../redis/index.js';

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

type StorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

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

const toSeconds = (milliseconds: number): number => Math.ceil(milliseconds / MS_PER_SECOND);

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  private readonly client: RedisWithThrottle;

  constructor(redis: RedisService) {
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
