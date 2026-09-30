import { Injectable, Logger } from '@nestjs/common';
import { METRIC_COUNTERS, RedisService, metricsKeys, type MetricCounter } from '../redis/index.js';
import { utcDayOf } from './utc-day.js';

/** Past the longest window (30 days), so every day a window asks for exists. */
const COUNTER_TTL_SECONDS = 100 * 86_400;
const WARN_EVERY_MS = 60_000;

export type CounterTable = Map<string, Record<MetricCounter, number>>;

@Injectable()
export class MetricsCounterService {
  private readonly logger = new Logger(MetricsCounterService.name);
  private lastWarnAt = 0;

  constructor(private readonly redis: RedisService) {}

  /** Never awaited by a request. A count lost to a Redis outage is lost. */
  increment(name: MetricCounter): void {
    const key = metricsKeys.counter(name, utcDayOf(new Date()));
    try {
      this.redis.client
        .multi()
        .incr(key)
        .expire(key, COUNTER_TTL_SECONDS)
        .exec()
        .catch((error: unknown) => this.warn(name, error));
    } catch (error) {
      this.warn(name, error);
    }
  }

  /** An absent key is a day with nothing to count: 0, not unknown. */
  async read(days: readonly string[]): Promise<CounterTable> {
    const keys = days.flatMap((day) =>
      METRIC_COUNTERS.map((name) => metricsKeys.counter(name, day)),
    );
    const values = await this.redis.client.mget(...keys);

    const table: CounterTable = new Map();
    days.forEach((day, d) => {
      const row = {} as Record<MetricCounter, number>;
      METRIC_COUNTERS.forEach((name, c) => {
        const raw = values[d * METRIC_COUNTERS.length + c];
        const n = raw === null || raw === undefined ? 0 : Number(raw);
        row[name] = Number.isFinite(n) ? n : 0;
      });
      table.set(day, row);
    });
    return table;
  }

  private warn(name: MetricCounter, error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_EVERY_MS) {
      return;
    }
    this.lastWarnAt = now;
    this.logger.warn(
      `Could not count ${name}: ${error instanceof Error ? error.message : String(error)}; further failures are silent for a minute`,
    );
  }
}
