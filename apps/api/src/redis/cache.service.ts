import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { CACHE_NAMESPACE } from './cache.keys.js';
import { RedisService } from './redis.service.js';

/** Keys examined per SCAN round trip during a pattern invalidation. */
const SCAN_BATCH = 200;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/**
 * The cache. Every method treats a Redis failure as a miss and carries on: a
 * cache that throws turns a degraded dependency into an outage, and the whole
 * point of this data being cached is that it can be fetched again.
 *
 * That tolerance is also why locks must not be taken through this class — see
 * the note on `lockKeys` in cache.keys.ts.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  /**
   * Loads already in progress, keyed by cache key. Without this, every request
   * that arrives in the moment after a popular entry expires starts its own
   * identical call to the upstream API.
   */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  /**
   * The TTL table from docs/Architecture.md section 8, surfaced here so that
   * reaching for a TTL is easier than writing a number.
   */
  readonly ttl: AppConfig['cache']['ttl'];

  constructor(
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.ttl = config.cache.ttl;
  }

  /**
   * Pass `schema` for anything containing dates. JSON has no date type, so a
   * cached `Date` returns as a string while TypeScript goes on insisting it is
   * a `Date` — a lie that surfaces somewhere far from here. The schemas in
   * @pokedrop/shared coerce it back.
   */
  async get<T>(key: string, schema?: ZodType<T>): Promise<T | null> {
    let raw: string | null;

    try {
      raw = await this.redis.client.get(key);
    } catch (error) {
      this.logger.warn(`Cache read failed for ${key}: ${describe(error)}`);
      return null;
    }

    if (raw === null) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn(`Cached value at ${key} is not valid JSON; dropping it`);
      await this.drop(key);
      return null;
    }

    if (!schema) {
      return parsed as T;
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      // Almost always means the shape changed in a deploy. Dropping the entry
      // keeps a schema change from poisoning the key until its TTL runs out.
      this.logger.warn(`Cached value at ${key} no longer matches its schema; dropping it`);
      await this.drop(key);
      return null;
    }

    return result.data;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (value === undefined) {
      return;
    }

    try {
      await this.redis.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`Cache write failed for ${key}: ${describe(error)}`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }

    try {
      await this.redis.client.unlink(...keys);
    } catch (error) {
      this.logger.warn(`Cache delete failed: ${describe(error)}`);
    }
  }

  /**
   * Returns the cached value, or runs `loader`, stores its result and returns
   * that.
   *
   * A `null` from `loader` is stored but reads back as a miss, so callers whose
   * absence is meaningful should represent it as something other than `null`
   * rather than re-loading on every request.
   */
  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
    schema?: ZodType<T>,
  ): Promise<T> {
    const hit = await this.get<T>(key, schema);
    if (hit !== null) {
      return hit;
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      return (await existing) as T;
    }

    const load = loader()
      .then(async (value) => {
        await this.set(key, value, ttlSeconds);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, load);
    return load;
  }

  /**
   * Deletes every key matching a glob, and returns how many went.
   *
   * Patterns are required to stay inside the cache namespace. The queue lives
   * in its own logical database already, but that separation is one edited line
   * of .env away from disappearing, whereas this check fails loudly.
   */
  async invalidate(pattern: string): Promise<number> {
    if (!pattern.startsWith(`${CACHE_NAMESPACE}:`)) {
      throw new Error(
        `Refusing to invalidate "${pattern}": patterns must stay inside the ` +
          `"${CACHE_NAMESPACE}:" namespace, or a careless glob takes the queues with it.`,
      );
    }

    const client = this.redis.client;
    let cursor = '0';
    let removed = 0;

    try {
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_BATCH);
        cursor = next;

        if (keys.length > 0) {
          // UNLINK, not DEL: the memory is reclaimed on a background thread, so
          // clearing a large namespace does not stall every other caller.
          removed += await client.unlink(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(`Cache invalidation of ${pattern} stopped early: ${describe(error)}`);
    }

    return removed;
  }

  private async drop(key: string): Promise<void> {
    try {
      await this.redis.client.unlink(key);
    } catch (error) {
      this.logger.warn(`Could not drop ${key}, leaving it to expire: ${describe(error)}`);
    }
  }
}
