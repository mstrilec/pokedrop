import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { SyncKind, SyncStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { PrismaService } from '../prisma/index.js';
import { QUEUE } from '../queue/index.js';
import {
  ProviderBreakerService,
  ProviderContractError,
  ProviderRateLimitError,
  ProviderSelectorService,
  ProviderUnavailableError,
  RequestBudgetService,
  type ProviderChoice,
} from './providers/index.js';
import { PriceBatchService } from './price-batch.service.js';
import { SyncRunService } from './sync-run.service.js';

/**
 * 250, measured 2026-09-21: a batch of 100 costs 4.53 s and a batch of 250
 * costs 12.57 s, so the cost is roughly linear in cards and the catalog is 83
 * requests at 250 against 207 at 100. Against a ceiling of 1 000 requests a day
 * that difference is the whole argument; wall clock is not - a full pass at 250
 * measured 874.6 s (14.6 min), 18 193 processed, 1 500 failed.
 */
const BATCH_SIZE = 250;

/**
 * The first 429 wait, doubling, capped. Sized against the documented ceiling of
 * 30 requests a minute rather than against http.ts's 250 ms base, which is sized
 * for a 5xx - a rate limit measured per minute cannot be cleared by waiting a
 * quarter of a second.
 */
const STALL_BASE_MS = 30_000;
const STALL_CAP_MS = 300_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What one batch tells the loop. `stalled` and `failed` are deliberately
 * separate: a rate limit is not a failure, and conflating them would both
 * inflate the run's failure count and let a slow night look like a broken one.
 */
interface BatchOutcome {
  processed: number;
  failed: number;
  stalled: boolean;
  down: boolean;
}

@Processor(QUEUE.priceSweep)
export class PriceSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(PriceSweepProcessor.name);

  private readonly reserve: number;
  private readonly maxStalls: number;

  constructor(
    private readonly selector: ProviderSelectorService,
    private readonly breaker: ProviderBreakerService,
    private readonly budget: RequestBudgetService,
    private readonly prisma: PrismaService,
    private readonly batch: PriceBatchService,
    private readonly runs: SyncRunService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    super();
    this.reserve = config.priceSweep.reserve;
    this.maxStalls = config.priceSweep.maxStalls;
  }

  async process(job: Job): Promise<void> {
    const resumable = await this.runs.findResumable(SyncKind.PRICE, job.id ?? '');

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
    const run = await this.runs.startOrResume(SyncKind.PRICE, provider.name, job.id ?? '');
    const log = (message: string): void =>
      this.logger.log(`run ${run.id} job ${job.id}: ${message}`);

    // The two resumptions, kept apart. A retry continues this run from its own
    // row; a fresh run continues from where the last finished run stopped, which
    // is what makes "full sweep" true in aggregate rather than per night.
    let lastCardId =
      resumable === null
        ? (await this.runs.lastClosedCursor(SyncKind.PRICE)).lastCardId
        : this.runs.readPriceCursor(run).lastCardId;

    const startedFrom = lastCardId;
    let wrapped = false;

    let processed = run.processed;
    let failed = run.failed;
    let stalls = 0;

    // Two different endings, and they must not be one variable. `completed`
    // says the pass covered the catalog; `stoppedBecause` says it was cut
    // short and why. A run that swept everything has nothing to report, and a
    // run that stopped at the budget must not be able to claim SUCCEEDED by
    // leaving a reason unset.
    let completed = false;
    let stoppedBecause: string | null = null;

    log(`starting after card id "${lastCardId}" via ${provider.name}`);

    for (;;) {
      if (!(await this.budget.hasHeadroom(provider.name, this.reserve))) {
        const state = await this.budget.stateOf(provider.name);
        stoppedBecause = `daily request budget exhausted: ${state.used} of ${state.limit ?? 'unlimited'} spent, reserve ${this.reserve}`;
        break;
      }

      const rows = await this.prisma.card.findMany({
        where: { id: { gt: lastCardId } },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: { id: true },
      });

      if (rows.length === 0) {
        // The end of the catalog. A run that began at the start has now covered
        // it; one that began mid-table wraps once to pick up what lay behind
        // its starting point. A second wrap would sweep for ever.
        if (wrapped || startedFrom === '') {
          completed = true;
          break;
        }

        wrapped = true;
        lastCardId = '';
        log('reached the end of the catalog, wrapping to the start');
        continue;
      }

      // Having wrapped, this batch may cross the position the run began at.
      // Everything at or below it belongs to this pass; everything above it was
      // already swept before the wrap. Ids sort lexicographically and the query
      // walks them in that order, so the comparison is the order the cursor
      // advances in. That equivalence depends on docker-compose.yml initialising
      // the cluster with --locale=C, which makes `ORDER BY id` byte order; a
      // default en_US.UTF-8 cluster's ICU collation ignores the hyphen at
      // primary strength, so ids like "sm3-9" and "sm35-1" would order
      // differently in Postgres than in JS. If that ever changes, the cost is
      // bounded to a handful of cards near the wrap boundary re-priced or
      // skipped once per wrap, not a termination problem.
      const ids = wrapped
        ? rows.map((row) => row.id).filter((id) => id <= startedFrom)
        : rows.map((row) => row.id);

      if (ids.length === 0) {
        completed = true;
        lastCardId = startedFrom;
        break;
      }

      // The cast, not a fallback: `ids` is non-empty by the guard above, which
      // noUncheckedIndexedAccess cannot see through an index expression.
      const batchEnd = ids[ids.length - 1] as string;
      const lastOfPass = wrapped && batchEnd >= startedFrom;

      let outcome: BatchOutcome;

      try {
        outcome = await this.runBatch(ids, choice, run.id, stalls);
      } catch (error) {
        // A contract error is the only thing runBatch lets out: the upstream
        // changed shape, and continuing would fill the mirror with nonsense.
        // PriceBatchService has already recorded the breaker failure, so this
        // only decides the run's fate.
        await this.runs.close(run.id, SyncStatus.FAILED, describe(error));
        throw error;
      }

      if (outcome.stalled) {
        stalls += 1;

        if (stalls >= this.maxStalls) {
          stoppedBecause = `rate limited ${stalls} times consecutively`;
          break;
        }

        // The cursor does not move. The same batch is asked for again on the
        // next turn of the loop, after the wait runBatch already took.
        continue;
      }

      stalls = 0;
      processed += outcome.processed;
      failed += outcome.failed;
      lastCardId = batchEnd;

      await this.runs.recordProgress(run.id, processed, failed, { lastCardId });
      await job.updateProgress({ processed, failed, lastCardId });

      if (outcome.down) {
        stoppedBecause = `${provider.name} breaker opened`;
        break;
      }

      if (lastOfPass) {
        completed = true;
        break;
      }
    }

    // Not a redundant rewrite: this is the only cursor write for three exit
    // paths - the budget exhausted or the stall ceiling reached before any
    // batch ran, and a completed wrap, where `lastCardId = startedFrom` is
    // assigned above in the `ids.length === 0` branch and never written inside
    // the loop. That last path is the consequential one - without this write,
    // tomorrow's run would read a smaller post-wrap cursor from
    // `lastClosedCursor` and re-sweep the whole region below `startedFrom`.
    await this.runs.recordProgress(run.id, processed, failed, { lastCardId });

    const status =
      completed && failed === 0 && !choice.isFallback ? SyncStatus.SUCCEEDED : SyncStatus.PARTIAL;

    const notes = [
      choice.isFallback ? `fallback via ${provider.name} (${choice.reason})` : null,
      stoppedBecause,
    ].filter((note): note is string => note !== null);

    await this.runs.close(run.id, status, notes.length > 0 ? notes.join('; ') : undefined);
    log(`finished ${status}: ${processed} processed, ${failed} failed, stopped at "${lastCardId}"`);
  }

  /**
   * One batch, plus the 429 wait. Everything but a contract error is turned
   * into an outcome the loop can act on, so the loop reads as a sequence rather
   * than as error handling.
   *
   * A rate limit is not a failure: it says the provider is healthy and we are
   * asking too fast. It is not counted into `failed`, it does not touch the
   * breaker, and the caller does not advance the cursor - the same batch is
   * asked for again after the wait.
   */
  private async runBatch(
    ids: string[],
    choice: ProviderChoice,
    runId: string,
    stalls: number,
  ): Promise<BatchOutcome> {
    try {
      const result = await this.batch.refreshBatch(ids, choice.provider);
      return { processed: result.priced, failed: 0, stalled: false, down: false };
    } catch (error) {
      if (error instanceof ProviderRateLimitError) {
        // Honour a Retry-After when the provider sends one; this upstream never
        // does, so in practice this is always the escalation below. `stalls` is
        // the count of consecutive stalls *before* this one (the loop increments
        // it after runBatch returns), so the first stall doubles from 0 and waits
        // the base 30 s, the second waits 60 s, and so on up to STALL_CAP_MS.
        const wait =
          error.retryAfterMs !== null
            ? Math.min(error.retryAfterMs, STALL_CAP_MS)
            : Math.min(STALL_BASE_MS * 2 ** stalls, STALL_CAP_MS);
        this.logger.warn(`run ${runId}: rate limited, waiting ${wait}ms - ${describe(error)}`);
        await sleep(wait);
        return { processed: 0, failed: 0, stalled: true, down: false };
      }

      // The upstream changed shape. The caller closes the run rather than
      // carrying on against a source that is no longer serving what we parse.
      if (error instanceof ProviderContractError) {
        throw error;
      }

      // refreshBatch has already recorded the breaker failure for the errors
      // that deserve one. What is left here is whether this run continues.
      let down = false;

      if (error instanceof ProviderUnavailableError) {
        // The breaker opening mid-run is what stops a sweep while a provider is
        // down. Without it a fully unavailable source would be asked for every
        // batch in the catalog, one retry budget at a time.
        down = await this.breaker.isOpen(choice.provider.name);
        this.logger.warn(
          `run ${runId}: a batch of ${ids.length} failed - ${describe(error)}${down ? ', breaker now open' : ''}`,
        );
      } else {
        this.logger.warn(
          `run ${runId}: a batch of ${ids.length} failed locally, not counted toward the breaker - ${describe(error)}`,
        );
      }

      return { processed: 0, failed: ids.length, stalled: false, down };
    }
  }
}
