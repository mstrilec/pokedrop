import { Injectable } from '@nestjs/common';
import { SyncKind } from '@prisma/client';
import {
  SyncStatusResponseSchema,
  type ProviderBreakerStateDto,
  type SyncRunSummary,
  type SyncStatusResponse,
} from '@pokedrop/shared';
import { CARD_SOURCE_NAMES } from '../config/index.js';
import { PrismaService } from '../prisma/index.js';
import { RedisService, breakerKeys } from '../redis/index.js';

@Injectable()
export class AdminSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async status(): Promise<SyncStatusResponse> {
    const [runs, breakers] = await Promise.all([this.lastRunPerKind(), this.breakerStates()]);
    return SyncStatusResponseSchema.parse({ runs, breakers });
  }

  /**
   * One row per kind rather than a list: the question this endpoint answers is
   * "what happened last", and `sync_runs` has an index on (kind, startedAt desc)
   * that makes each of these two queries a single index lookup.
   */
  private async lastRunPerKind(): Promise<SyncRunSummary[]> {
    const kinds = [SyncKind.CATALOG, SyncKind.PRICE];

    const rows = await Promise.all(
      kinds.map((kind) =>
        this.prisma.syncRun.findFirst({ where: { kind }, orderBy: { startedAt: 'desc' } }),
      ),
    );

    return rows.filter((row) => row !== null);
  }

  /**
   * Read straight from Redis rather than through ProviderBreakerService.
   *
   * Injecting that service would mean this module importing ProvidersModule,
   * putting the sync layer's tokens into the API process's context - the
   * coupling CatalogModule's empty `imports` array exists to avoid. The cost is
   * that two files parse the same two keys, which is why the key builders live
   * in redis/cache.keys.ts rather than beside the breaker.
   */
  private async breakerStates(): Promise<ProviderBreakerStateDto[]> {
    return Promise.all(
      CARD_SOURCE_NAMES.map(async (provider) => {
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
        } catch {
          // Redis being down is not a reason for the admin page to 500. A
          // breaker that cannot be read reports as closed, which is also what
          // the selector assumes.
          return { provider, failures: 0, openUntil: null };
        }
      }),
    );
  }
}
