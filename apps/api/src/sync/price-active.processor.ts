import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { SyncKind, SyncStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
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
import { ActiveCardSelector } from './active-card.selector.js';
import { PriceBatchService } from './price-batch.service.js';
import { SyncRunService } from './sync-run.service.js';

/** The same 250 PD-49 measured: 100 cards cost 4.53 s and 250 cost 12.57 s. */
const BATCH_SIZE = 250;

/** As in the sweep: sized against a ceiling of 30 requests a minute. */
const STALL_BASE_MS = 30_000;
const STALL_CAP_MS = 300_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface BatchOutcome {
  processed: number;
  failed: number;
  stalled: boolean;
  down: boolean;
}

@Processor(QUEUE.priceActive)
export class PriceActiveProcessor extends WorkerHost {
  private readonly logger = new Logger(PriceActiveProcessor.name);

  private readonly reserve: number;
  private readonly maxStalls: number;

  constructor(
    private readonly selector: ProviderSelectorService,
    private readonly breaker: ProviderBreakerService,
    private readonly budget: RequestBudgetService,
    private readonly active: ActiveCardSelector,
    private readonly batch: PriceBatchService,
    private readonly runs: SyncRunService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    super();
    this.reserve = config.priceActive.reserve;
    this.maxStalls = config.priceSweep.maxStalls;
  }

  async process(job: Job): Promise<void> {
    const resumable = await this.runs.findResumable(SyncKind.PRICE_ACTIVE, job.id ?? '');

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
    const run = await this.runs.startOrResume(SyncKind.PRICE_ACTIVE, provider.name, job.id ?? '');
    const log = (message: string): void =>
      this.logger.log(`run ${run.id} job ${job.id}: ${message}`);

    // Re-selected on every run, including a BullMQ retry. There is no cursor
    // because there is nothing to resume: the set is derived fresh and bounded,
    // and cards a failed attempt did not reach are staler now and therefore
    // sort higher in the next selection.
    const selection = await this.active.select();
    log(
      `${selection.cardIds.length} active cards selected${selection.truncated ? ' (truncated by the bound)' : ''}`,
    );

    // Starts at 0 rather than resuming from `run.processed` / `run.failed` as
    // the sweep does: this job re-selects its entire set on every attempt,
    // including a BullMQ retry, so there is no earlier attempt's count to
    // carry forward - attempt 2's counters describe attempt 2's work.
    let processed = 0;
    let failed = 0;
    let stalls = 0;
    let stoppedBecause: string | null = null;

    for (let offset = 0; offset < selection.cardIds.length;) {
      if (!(await this.budget.hasHeadroom(provider.name, this.reserve))) {
        const state = await this.budget.stateOf(provider.name);
        stoppedBecause = `daily request budget exhausted: ${state.used} of ${state.limit ?? 'unlimited'} spent, reserve ${this.reserve}`;
        break;
      }

      const ids = selection.cardIds.slice(offset, offset + BATCH_SIZE);

      let outcome: BatchOutcome;

      try {
        outcome = await this.runBatch(ids, choice, run.id, stalls);
      } catch (error) {
        // Only a contract error escapes runBatch: the upstream changed shape.
        // PriceBatchService has already recorded the breaker failure.
        await this.runs.close(run.id, SyncStatus.FAILED, describe(error));
        throw error;
      }

      if (outcome.stalled) {
        stalls += 1;

        if (stalls >= this.maxStalls) {
          stoppedBecause = `rate limited ${stalls} times consecutively`;
          break;
        }

        // `offset` does not advance. The same batch is asked for again after
        // the wait runBatch already took.
        continue;
      }

      stalls = 0;
      processed += outcome.processed;
      failed += outcome.failed;
      offset += ids.length;

      await this.runs.recordProgress(run.id, processed, failed, {
        lastCardId: ids[ids.length - 1] as string,
      });
      await job.updateProgress({ processed, failed, offset });

      if (outcome.down) {
        stoppedBecause = `${provider.name} breaker opened`;
        break;
      }
    }

    // A truncated selection is not a complete piece of work even when every
    // batch succeeded: cards were eligible and went unpriced.
    //
    // Neither is a selection the loop ran to completion on. `processed` is
    // `result.priced` summed across batches - the count the provider actually
    // returned prices for - not the count of ids asked for. A batch that
    // fails outright is caught above and counted into `failed`, but a batch
    // the provider answers with fewer cards than it was asked for is not a
    // failure at all, so it leaves a gap that neither `failed` nor
    // `stoppedBecause` explains on its own.
    const notes = [
      choice.isFallback ? `fallback via ${provider.name} (${choice.reason})` : null,
      stoppedBecause,
      selection.truncated && stoppedBecause === null
        ? `bounded at ${selection.cardIds.length} cards; more were eligible`
        : null,
      stoppedBecause === null && processed < selection.cardIds.length
        ? `provider returned no price for ${selection.cardIds.length - processed} of ${selection.cardIds.length} cards asked`
        : null,
    ].filter((note): note is string => note !== null);

    const status = notes.length === 0 && failed === 0 ? SyncStatus.SUCCEEDED : SyncStatus.PARTIAL;

    await this.runs.close(run.id, status, notes.length > 0 ? notes.join('; ') : undefined);
    log(`finished ${status}: ${processed} processed, ${failed} failed`);
  }

  /**
   * One batch, plus the 429 wait. Everything but a contract error becomes an
   * outcome the loop can act on.
   *
   * A rate limit is not a failure: it says the provider is healthy and we are
   * asking too fast. It is not counted into `failed`, it does not touch the
   * breaker, and the caller does not advance past the batch.
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
        // does, so in practice this is the escalation. `stalls` is the count
        // before this one, so the first wait is the base rather than double it.
        const wait = Math.min(error.retryAfterMs ?? STALL_BASE_MS * 2 ** stalls, STALL_CAP_MS);
        this.logger.warn(`run ${runId}: rate limited, waiting ${wait}ms - ${describe(error)}`);
        await sleep(wait);
        return { processed: 0, failed: 0, stalled: true, down: false };
      }

      if (error instanceof ProviderContractError) {
        throw error;
      }

      let down = false;

      if (error instanceof ProviderUnavailableError) {
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
