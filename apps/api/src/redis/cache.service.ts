import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { CACHE_NAMESPACE } from './cache.keys.js';
import { RedisService } from './redis.service.js';

const SCAN_BATCH = 200;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  private readonly inFlight = new Map<string, Promise<unknown>>();

  /**
   * Per-process, in memory, and reset by a restart.
   *
   * Redis counters would survive and would aggregate across replicas, at the
   * cost of an INCR on every read - doubling the round trips of the thing the
   * cache exists to make cheap. There is one API process today; when PD-129
   * runs replicas, an admin dashboard summing these will be reading one of
   * them, and that is the moment to move them into Redis.
   */
  private hits = 0;
  private misses = 0;

  readonly ttl: AppConfig['cache']['ttl'];

  constructor(
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.ttl = config.cache.ttl;
  }

  async get<T>(key: string, schema?: ZodType<T>): Promise<T | null> {
    let raw: string | null;

    try {
      raw = await this.redis.client.get(key);
    } catch (error) {
      this.logger.warn(`Cache read failed for ${key}: ${describe(error)}`);
      this.misses += 1;
      return null;
    }

    if (raw === null) {
      this.misses += 1;
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn(`Cached value at ${key} is not valid JSON; dropping it`);
      await this.drop(key);
      this.misses += 1;
      return null;
    }

    if (!schema) {
      this.hits += 1;
      return parsed as T;
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      this.logger.warn(`Cached value at ${key} no longer matches its schema; dropping it`);
      await this.drop(key);
      this.misses += 1;
      return null;
    }

    this.hits += 1;
    return result.data;
  }

  /**
   * Hit and miss totals since this process started.
   *
   * A miss is counted once per `get` that did not return a value - including a
   * Redis failure and a value dropped for not matching its schema, because from
   * a caller's point of view all three are the same thing: the database has to
   * be asked.
   */
  stats(): { hits: number; misses: number } {
    return { hits: this.hits, misses: this.misses };
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
   * A `null` from `loader` is stored but reads back as a miss, so a loader whose
   * absence is meaningful re-runs on every request. Pass `schema` for anything
   * carrying dates: JSON has no date type, so a cached `Date` returns a string
   * while TypeScript goes on insisting it is a `Date`.
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
