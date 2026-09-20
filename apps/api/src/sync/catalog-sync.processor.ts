import { Processor, WorkerHost } from '@nestjs/bullmq';
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
    const choice: ProviderChoice = await this.selector.select();
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

    // Sets first, always. cards."setId" references sets(id) with onDelete
    // Restrict, so a card whose set is missing fails the insert.
    //
    // Skipped on a resume: the sets were written before the cursor advanced
    // past page 1, and re-fetching them would spend requests on a rate limit
    // we cannot observe.
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

      try {
        const result = await provider.fetchCards({ page, pageSize: PAGE_SIZE });

        // Rule two. A fallback run may only write a card whose id is ALREADY in
        // the mirror. It refreshes; it never introduces.
        //
        // Checking the set instead of the card is not enough, and that was
        // measured the expensive way: TCGdex zero-pads card numbers inside sets
        // both providers share, so `sv10-060` and `sv10-60` are one physical
        // card under two ids. A set-level filter passes both, and a real
        // failover run put 593 duplicates into the mirror before this was
        // caught. The set rule survives as rule one; this is what makes it
        // sufficient.
        const writable = choice.isFallback
          ? await this.alreadyMirrored(result.items)
          : result.items;

        unwritable += result.items.length - writable.length;

        // A page is fetched in full before a transaction opens. Fetching inside
        // one would hold write locks for as long as the client spends retrying,
        // which against this upstream is seconds per page.
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

        // Consecutive is what makes the threshold mean an outage. One good page
        // is evidence the provider is serving.
        await this.breaker.recordSuccess(provider.name);
      } catch (error) {
        if (error instanceof ProviderContractError) {
          // The upstream changed shape. Continuing would fill the mirror with
          // nonsense, which is worse than stopping.
          await this.breaker.recordFailure(provider.name);
          await this.runs.close(run.id, SyncStatus.FAILED, describe(error));
          throw error;
        }

        failed += 1;

        // A 429 says the upstream is healthy and we are asking too fast.
        // Counting it would move the load onto the fallback and rate-limit that
        // one too - the rule sync/README.md and http.ts both already state.
        if (!(error instanceof ProviderRateLimitError)) {
          const count = await this.breaker.recordFailure(provider.name);
          this.logger.warn(
            `run ${run.id}: page ${page} failed (${count} consecutive) - ${describe(error)}`,
          );
        } else {
          this.logger.warn(`run ${run.id}: page ${page} rate limited - ${describe(error)}`);
        }

        // Keep going. A page that exhausted its retry budget is one page, and
        // the next may well succeed - this upstream fails about 70% of
        // individual requests.
        hasMore = true;
      }

      page += 1;
      await this.runs.recordProgress(run.id, processed, failed, { page });
      await job.updateProgress({ processed, failed, page });

      if (!hasMore) {
        break;
      }
    }

    // A fallback run is partial by definition: it refreshed the 73.6% of the
    // mirror whose set ids both providers share and deliberately left the rest.
    // Reporting SUCCEEDED would be a lie told to the one person reading the
    // admin page during an outage.
    const status = choice.isFallback || failed > 0 ? SyncStatus.PARTIAL : SyncStatus.SUCCEEDED;

    const reason = choice.isFallback
      ? `fallback via ${provider.name} (${choice.reason}); no set written, ` +
        `${unwritable} cards skipped as not already mirrored`
      : undefined;

    await this.invalidate();
    await this.runs.close(run.id, status, reason);
    log(`finished ${status}: ${processed} processed, ${failed} failed, ${unwritable} unwritable`);
  }

  /**
   * Which of this page's cards the mirror already holds.
   *
   * One indexed primary-key lookup of at most 250 ids per page, rather than
   * loading all 20 670 ids once: the per-page query is bounded in memory and
   * reflects the table as it is now, and 83 such queries across a sweep is
   * noise beside the upserts they guard.
   */
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

  /**
   * Only on a run that wrote something. A failed run leaves the mirror no less
   * current than it was, and flushing a warm cache to refill it with the same
   * data is a cost with no benefit.
   *
   * Prices are deliberately untouched: cachePatterns.allPrices() belongs to
   * M4's write path, and a catalog sync cannot change a price column.
   */
  private async invalidate(): Promise<void> {
    await this.cache.invalidate(cachePatterns.allSets());
    await this.cache.invalidate(cachePatterns.allCards());
    await this.cache.del(cacheKeys.facets());
  }
}
