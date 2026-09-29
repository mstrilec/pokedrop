import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SyncKind, SyncStatus, type SyncRun } from '@prisma/client';
import {
  SyncStatusResponseSchema,
  type ProviderBreakerStateDto,
  type QueueDepth,
  type SyncRunSummary,
  type SyncStatusResponse,
} from '@pokedrop/shared';
import type { Queue } from 'bullmq';
import {
  APP_CONFIG,
  CARD_SOURCE_NAMES,
  type AppConfig,
  type CardSourceName,
} from '../config/index.js';
import { PrismaService } from '../prisma/index.js';
import { QUEUE } from '../queue/index.js';
import { RedisService, breakerKeys } from '../redis/index.js';
import { chooseProvider } from '../sync/providers/index.js';
import { withTimeout } from './with-timeout.js';

type StatusQueue =
  | typeof QUEUE.catalogSync
  | typeof QUEUE.priceSweep
  | typeof QUEUE.priceActive
  | typeof QUEUE.priceSync;

const DEPTH_QUEUES: readonly StatusQueue[] = [
  QUEUE.catalogSync,
  QUEUE.priceSweep,
  QUEUE.priceActive,
  QUEUE.priceSync,
];

const RUN_QUEUE: Record<SyncKind, StatusQueue> = {
  [SyncKind.CATALOG]: QUEUE.catalogSync,
  [SyncKind.PRICE]: QUEUE.priceSweep,
  [SyncKind.PRICE_ACTIVE]: QUEUE.priceActive,
};

const FINISHED_STATES = new Set(['completed', 'failed', 'unknown']);

@Injectable()
export class AdminSyncService {
  private readonly logger = new Logger(AdminSyncService.name);
  private readonly primary: CardSourceName;
  private readonly queues: Record<StatusQueue, Queue>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) config: AppConfig,
    @InjectQueue(QUEUE.catalogSync) catalogSync: Queue,
    @InjectQueue(QUEUE.priceSweep) priceSweep: Queue,
    @InjectQueue(QUEUE.priceActive) priceActive: Queue,
    @InjectQueue(QUEUE.priceSync) priceSync: Queue,
  ) {
    this.primary = config.providers.active;
    this.queues = {
      [QUEUE.catalogSync]: catalogSync,
      [QUEUE.priceSweep]: priceSweep,
      [QUEUE.priceActive]: priceActive,
      [QUEUE.priceSync]: priceSync,
    };
  }

  /**
   * Each section is read on its own, so one dependency down costs that section
   * and not the page - the page an operator reads during exactly that incident.
   */
  async status(): Promise<SyncStatusResponse> {
    const [runs, queues, breakers] = await Promise.all([
      this.section('runs', () => this.lastRunPerKind()),
      this.section('queues', () => this.depths()),
      this.section('breakers', () => this.breakerStates()),
    ]);

    // With the breakers unreadable the selector treats every breaker as closed,
    // so the primary is what the next run would really choose.
    const open = new Set(
      (breakers ?? [])
        .filter((breaker) => breaker.openUntil !== null)
        .map((breaker) => breaker.provider as CardSourceName),
    );
    const next = chooseProvider(this.primary, CARD_SOURCE_NAMES, open);

    return SyncStatusResponseSchema.parse({
      runs,
      queues,
      breakers,
      primaryProvider: this.primary,
      nextProvider: next?.name ?? null,
    });
  }

  private async section<T>(name: string, read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      this.logger.warn(`sync status: ${name} unreadable - ${describe(error)}`);
      return null;
    }
  }

  private async lastRunPerKind(): Promise<SyncRunSummary[]> {
    const rows = await Promise.all(
      Object.values(SyncKind).map((kind) =>
        this.prisma.syncRun.findFirst({ where: { kind }, orderBy: { startedAt: 'desc' } }),
      ),
    );

    return Promise.all(
      rows
        .filter((row) => row !== null)
        .map(async (row) => ({
          kind: row.kind,
          provider: row.provider,
          status: row.status,
          startedAt: row.startedAt,
          finishedAt: row.finishedAt,
          durationMs:
            row.finishedAt === null ? null : row.finishedAt.getTime() - row.startedAt.getTime(),
          processed: row.processed,
          failed: row.failed,
          error: row.error,
          jobId: row.jobId,
          stale: row.status === SyncStatus.RUNNING ? await this.isStale(row) : false,
        })),
    );
  }

  /**
   * True when nothing will ever close this row: its job is gone, finished, or
   * was never recorded. A job that is waiting, delayed or running will close
   * it, or its final failure will.
   */
  private async isStale(row: SyncRun): Promise<boolean | null> {
    if (row.jobId === null) {
      return true;
    }
    try {
      const state = await withTimeout(
        this.queues[RUN_QUEUE[row.kind]].getJobState(row.jobId),
        `job ${row.jobId} state`,
      );
      return FINISHED_STATES.has(state);
    } catch (error) {
      this.logger.warn(`sync status: job ${row.jobId} unreadable - ${describe(error)}`);
      return null;
    }
  }

  private async depths(): Promise<QueueDepth[]> {
    return Promise.all(
      DEPTH_QUEUES.map(async (name) => {
        const counts = await withTimeout(
          this.queues[name].getJobCounts('waiting', 'paused', 'active', 'delayed', 'failed'),
          `${name} counts`,
        );
        return {
          queue: name,
          waiting: (counts['waiting'] ?? 0) + (counts['paused'] ?? 0),
          active: counts['active'] ?? 0,
          delayed: counts['delayed'] ?? 0,
          failed: counts['failed'] ?? 0,
        };
      }),
    );
  }

  /**
   * Read straight from Redis rather than through ProviderBreakerService, which
   * would pull the sync layer's providers into the API's admin module. An open
   * key without a TTL still counts as open, as isOpen() reads it.
   */
  private async breakerStates(): Promise<ProviderBreakerStateDto[]> {
    return Promise.all(
      CARD_SOURCE_NAMES.map(async (provider) => {
        const [raw, ttl] = await withTimeout(
          Promise.all([
            this.redis.client.get(breakerKeys.failures(provider)),
            this.redis.client.ttl(breakerKeys.open(provider)),
          ]),
          `breaker ${provider}`,
        );
        const failures = raw === null ? 0 : Number(raw);
        return {
          provider,
          failures: Number.isFinite(failures) ? failures : 0,
          openUntil: openUntilOf(ttl),
        };
      }),
    );
  }
}

/**
 * -2 is no key, a closed breaker. -1 is a key with no expiry: open, with no
 * end, reported a cooldown from now so the page shows it open.
 */
export function openUntilOf(ttl: number): Date | null {
  if (ttl === -2) {
    return null;
  }
  return new Date(Date.now() + (ttl > 0 ? ttl : 1_800) * 1_000);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
