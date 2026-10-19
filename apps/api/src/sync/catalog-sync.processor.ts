import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { SyncKind, SyncStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/index.js';
import { QUEUE } from '../queue/index.js';
import { CacheService, cacheKeys, cachePatterns } from '../redis/index.js';
import { CatalogWriter } from './catalog.writer.js';
import {
  ProviderBreakerService,
  ProviderContractError,
  ProviderRateLimitError,
  ProviderSelectorService,
  ProviderUnavailableError,
  type CardDTO,
  type ProviderChoice,
} from './providers/index.js';
import { SyncRunService } from './sync-run.service.js';

const PAGE_SIZE = 250;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Processor(QUEUE.catalogSync)
export class CatalogSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(CatalogSyncProcessor.name);

  constructor(
    private readonly selector: ProviderSelectorService,
    private readonly breaker: ProviderBreakerService,
    private readonly prisma: PrismaService,
    private readonly writer: CatalogWriter,
    private readonly runs: SyncRunService,
    private readonly cache: CacheService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const resumable = await this.runs.findResumable(SyncKind.CATALOG, job.id ?? '');

    let choice: ProviderChoice;

    if (resumable === null) {
      choice = await this.selector.select();
    } else {
      const resumed = await this.selector.resume(resumable.provider);

      if (resumed === null) {
        await this.runs.close(
          resumable.id,
          SyncStatus.PARTIAL,
          `resume abandoned: the breaker for ${resumable.provider} opened while this run was in flight`,
        );
        this.logger.warn(
          `run ${resumable.id}: abandoned on resume, ${resumable.provider} is now breaking`,
        );
        return;
      }

      choice = resumed;
    }

    const provider = choice.provider;

    const run = await this.runs.startOrResume(SyncKind.CATALOG, provider.name, job.id ?? '');
    const log = (message: string): void =>
      this.logger.log(`run ${run.id} job ${job.id}: ${message}`);

    if (choice.isFallback) {
      log(`fallback run via ${provider.name} (${choice.reason}); sets will not be written`);
    }

    let processed = run.processed;
    let failed = run.failed;
    let unwritable = 0;
    let page = this.runs.readCursor(run).page;

    if (page === 1 && !choice.isFallback) {
      try {
        const sets = await provider.fetchSets();
        const written = await this.prisma.withTransaction((tx) => this.writer.upsertSets(tx, sets));
        log(`${sets.length} sets fetched, ${written} rows written`);
      } catch (error) {
        await this.breaker.recordFailure(provider.name);
        await this.runs.close(run.id, SyncStatus.FAILED, describe(error));
        throw error;
      }
    }

    for (;;) {
      let hasMore = false;
      let providerDown = false;

      try {
        const result = await provider.fetchCards({ page, pageSize: PAGE_SIZE });

        // Rule two: a fallback run writes only cards whose id is already in the mirror.
        // A set-level check is not enough: TCGdex zero-pads numbers (`sv10-060` vs
        // `sv10-60`), which forked the catalog.
        const writable = choice.isFallback
          ? await this.alreadyMirrored(result.items)
          : result.items;

        unwritable += result.items.length - writable.length;

        // Fetched in full before the transaction opens, so no write lock is held through retries.
        const written = await this.prisma.withTransaction((tx) =>
          this.writer.upsertCards(tx, writable),
        );

        processed += result.items.length;
        failed += result.skipped.length;
        hasMore = result.hasMore;

        for (const skip of result.skipped) {
          this.logger.warn(
            `run ${run.id}: card ${skip.itemId ?? '(no id)'} skipped - ${skip.message}`,
          );
        }

        log(
          `page ${page}: ${result.items.length} cards, ${written} rows written, ${result.skipped.length} skipped`,
        );

        await this.breaker.recordSuccess(provider.name);
      } catch (error) {
        if (error instanceof ProviderContractError) {
          await this.breaker.recordFailure(provider.name);
          await this.runs.close(run.id, SyncStatus.FAILED, describe(error));
          throw error;
        }

        failed += 1;

        // Only a failure saying the provider is unusable counts toward the breaker. A 429
        // (healthy, too fast) or an error of ours (Prisma, a constraint, a lock) must not.
        if (error instanceof ProviderUnavailableError) {
          const count = await this.breaker.recordFailure(provider.name);
          this.logger.warn(
            `run ${run.id}: page ${page} failed, provider failure (${count} consecutive) - ${describe(error)}`,
          );

          if (await this.breaker.isOpen(provider.name)) {
            this.logger.warn(
              `run ${run.id}: stopping, ${provider.name} breaker opened after ${count} consecutive failures`,
            );
            providerDown = true;
          }
        } else if (error instanceof ProviderRateLimitError) {
          this.logger.warn(`run ${run.id}: page ${page} rate limited - ${describe(error)}`);
        } else {
          this.logger.warn(
            `run ${run.id}: page ${page} failed locally, not counted toward the breaker - ${describe(error)}`,
          );
        }

        hasMore = true;
      }

      page += 1;
      await this.runs.recordProgress(run.id, processed, failed, { page });
      await job.updateProgress({ processed, failed, page });

      if (providerDown || !hasMore) {
        break;
      }
    }

    const status = choice.isFallback || failed > 0 ? SyncStatus.PARTIAL : SyncStatus.SUCCEEDED;

    const reason = choice.isFallback
      ? `fallback via ${provider.name} (${choice.reason}); no set written, ` +
        `${unwritable} cards skipped as not already mirrored`
      : undefined;

    await this.invalidate();
    await this.runs.close(run.id, status, reason);
    log(`finished ${status}: ${processed} processed, ${failed} failed, ${unwritable} unwritable`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, error: Error): Promise<void> {
    await this.runs.closeIfFinallyFailed(SyncKind.CATALOG, job, error);
  }

  private async alreadyMirrored(items: CardDTO[]): Promise<CardDTO[]> {
    if (items.length === 0) {
      return items;
    }

    const rows = await this.prisma.card.findMany({
      where: { id: { in: items.map((card) => card.id) } },
      select: { id: true },
    });

    const known = new Set(rows.map((row) => row.id));
    return items.filter((card) => known.has(card.id));
  }

  private async invalidate(): Promise<void> {
    await this.cache.invalidate(cachePatterns.allSets());
    await this.cache.invalidate(cachePatterns.allCards());
    await this.cache.del(cacheKeys.facets());
  }
}
