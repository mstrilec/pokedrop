import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { SyncKind, SyncStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/index.js';
import { QUEUE } from '../queue/index.js';
import { CacheService, cacheKeys, cachePatterns } from '../redis/index.js';
import { CatalogWriter } from './catalog.writer.js';
import {
  CARD_SOURCE_PROVIDER,
  ProviderContractError,
  type CardSourceProvider,
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
    @Inject(CARD_SOURCE_PROVIDER) private readonly provider: CardSourceProvider,
    private readonly prisma: PrismaService,
    private readonly writer: CatalogWriter,
    private readonly runs: SyncRunService,
    private readonly cache: CacheService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const run = await this.runs.startOrResume(SyncKind.CATALOG, this.provider.name, job.id ?? '');
    const log = (message: string): void =>
      this.logger.log(`run ${run.id} job ${job.id}: ${message}`);

    let processed = run.processed;
    let failed = run.failed;
    let page = this.runs.readCursor(run).page;

    // Sets first, always. cards."setId" references sets(id) with onDelete
    // Restrict, so a card whose set is missing fails the insert.
    //
    // Skipped on a resume: the sets were written before the cursor advanced
    // past page 1, and re-fetching them would spend requests on a rate limit
    // we cannot observe.
    if (page === 1) {
      try {
        const sets = await this.provider.fetchSets();
        const written = await this.prisma.withTransaction((tx) => this.writer.upsertSets(tx, sets));
        log(`${sets.length} sets fetched, ${written} rows written`);
      } catch (error) {
        await this.runs.close(run.id, SyncStatus.FAILED, describe(error));
        throw error;
      }
    }

    for (;;) {
      let hasMore = false;

      try {
        const result = await this.provider.fetchCards({ page, pageSize: PAGE_SIZE });

        // A page is fetched in full before a transaction opens. Fetching inside
        // one would hold write locks for as long as the client spends retrying,
        // which against this upstream is seconds per page.
        const written = await this.prisma.withTransaction((tx) =>
          this.writer.upsertCards(tx, result.items),
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
      } catch (error) {
        if (error instanceof ProviderContractError) {
          // The upstream changed shape. Continuing would fill the mirror with
          // nonsense, which is worse than stopping.
          await this.runs.close(run.id, SyncStatus.FAILED, describe(error));
          throw error;
        }

        failed += 1;
        this.logger.warn(`run ${run.id}: page ${page} failed - ${describe(error)}`);
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

    const status = failed === 0 ? SyncStatus.SUCCEEDED : SyncStatus.PARTIAL;
    await this.invalidate();
    await this.runs.close(run.id, status);
    log(`finished ${status}: ${processed} processed, ${failed} failed`);
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
