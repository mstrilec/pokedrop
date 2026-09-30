import { Injectable, Logger } from '@nestjs/common';
import {
  AdminMetricsSchema,
  type AdminMetrics,
  type MetricsDay,
  type MetricsWindow,
} from '@pokedrop/shared';
import { MetricsCounterService, type CounterTable } from '../metrics/index.js';
import { PrismaService } from '../prisma/index.js';
import { CacheService, cacheKeys } from '../redis/index.js';
import { AdminSyncService } from './admin-sync.service.js';
import { withTimeout } from './with-timeout.js';

const CACHE_TTL_SECONDS = 60;
const DAY_MS = 86_400_000;

type DayRow = { day: string; n: bigint };
type StatusRow = DayRow & { status: string };
type DayCounts = Map<string, number>;

type Aggregates = {
  activeUsers: DayCounts;
  packsOpened: DayCounts;
  tradesProposed: DayCounts;
  resolved: Map<string, DayCounts>;
};

@Injectable()
export class AdminMetricsService {
  private readonly logger = new Logger(AdminMetricsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly counters: MetricsCounterService,
    private readonly sync: AdminSyncService,
  ) {}

  async metrics(days: MetricsWindow): Promise<AdminMetrics> {
    const key = cacheKeys.adminMetrics(days);
    const cached = await this.cache.get(key, AdminMetricsSchema);
    if (cached !== null) {
      return cached;
    }
    const fresh = await this.compute(days);
    await this.cache.set(key, fresh, CACHE_TTL_SECONDS);
    return fresh;
  }

  private async compute(days: number): Promise<AdminMetrics> {
    const now = new Date();
    const window = windowDays(now, days);
    const from = window[0] as string;
    const to = window[window.length - 1] as string;

    const [aggregates, counters, prices, status] = await Promise.all([
      this.section('aggregates', () => this.aggregates(from)),
      this.section('counters', () => withTimeout(this.counters.read(window), 'metrics counters')),
      this.section('prices', () => this.priceFreshness()),
      this.sync.status(),
    ]);

    const series =
      aggregates === null
        ? null
        : window.map((day) => toDay(day, day === to, aggregates, counters));
    const current = series?.at(-2);
    const previous = series?.at(-3);

    return AdminMetricsSchema.parse({
      generatedAt: now,
      window: { days, from, to },
      series,
      summary: current && previous ? { current, previous } : null,
      freshness: prices === null ? null : { ...prices, lastRuns: status.runs },
      queues: status.queues,
    });
  }

  private async section<T>(name: string, read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      this.logger.warn(
        `metrics: ${name} unreadable - ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** Each a range scan on its own index; see docs/API.md, Admin / Metrics. */
  private async aggregates(from: string): Promise<Aggregates> {
    const [active, packs, proposed, resolved] = await Promise.all([
      this.prisma.$queryRaw<DayRow[]>`
        SELECT to_char(day, 'YYYY-MM-DD') AS day, count(*) AS n
        FROM user_activity WHERE day >= ${from}::date GROUP BY 1`,
      this.prisma.$queryRaw<DayRow[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, count(*) AS n
        FROM pack_openings WHERE "createdAt" >= ${from}::timestamp GROUP BY 1`,
      this.prisma.$queryRaw<DayRow[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, count(*) AS n
        FROM trades WHERE "createdAt" >= ${from}::timestamp GROUP BY 1`,
      this.prisma.$queryRaw<StatusRow[]>`
        SELECT to_char(date_trunc('day', "resolvedAt"), 'YYYY-MM-DD') AS day,
               status::text AS status, count(*) AS n
        FROM trades WHERE "resolvedAt" >= ${from}::timestamp GROUP BY 1, 2`,
    ]);

    const byStatus = new Map<string, DayCounts>();
    for (const row of resolved) {
      const counts = byStatus.get(row.status) ?? new Map<string, number>();
      counts.set(row.day, Number(row.n));
      byStatus.set(row.status, counts);
    }

    return {
      activeUsers: countsOf(active),
      packsOpened: countsOf(packs),
      tradesProposed: countsOf(proposed),
      resolved: byStatus,
    };
  }

  private async priceFreshness(): Promise<{
    oldestPriceUpdatedAt: Date | null;
    cardsWithoutPrice: number;
  }> {
    const [oldest, cardsWithoutPrice] = await Promise.all([
      this.prisma.card.aggregate({ _min: { priceUpdatedAt: true } }),
      this.prisma.card.count({ where: { priceUpdatedAt: null } }),
    ]);
    return { oldestPriceUpdatedAt: oldest._min.priceUpdatedAt, cardsWithoutPrice };
  }
}

/** `days` UTC dates ending today, oldest first. */
export function windowDays(now: Date, days: number): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, i) =>
    new Date(today - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10),
  );
}

function countsOf(rows: DayRow[]): DayCounts {
  return new Map(rows.map((row) => [row.day, Number(row.n)]));
}

function toDay(
  day: string,
  partial: boolean,
  aggregates: Aggregates,
  counters: CounterTable | null,
): MetricsDay {
  const counted = counters?.get(day) ?? null;
  const requests = counted?.requests ?? null;
  const serverErrors = counted?.server_errors ?? null;
  const resolved = (status: string): number => aggregates.resolved.get(status)?.get(day) ?? 0;

  return {
    day,
    partial,
    activeUsers: aggregates.activeUsers.get(day) ?? 0,
    packsOpened: aggregates.packsOpened.get(day) ?? 0,
    tradesProposed: aggregates.tradesProposed.get(day) ?? 0,
    tradesAccepted: resolved('ACCEPTED'),
    tradesDeclined: resolved('DECLINED'),
    tradesCancelled: resolved('CANCELLED'),
    tradesCountered: resolved('COUNTERED'),
    tradesVoided: resolved('VOIDED'),
    requests,
    serverErrors,
    // Capped: a counter lost or evicted on one side must not make a day's rate
    // exceed 1 and fail the whole response for as long as it is in the window.
    errorRate:
      requests === null || serverErrors === null || requests === 0
        ? null
        : Math.min(1, serverErrors / requests),
    packFallbacks: counted?.pack_fallbacks ?? null,
    packUnavailable: counted?.pack_unavailable ?? null,
  };
}
