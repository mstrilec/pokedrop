import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
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

const BATCH_SIZE = 250;

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

    let lastCardId =
      resumable === null
        ? (await this.runs.lastClosedCursor(SyncKind.PRICE)).lastCardId
        : this.runs.readPriceCursor(run).lastCardId;

    const startedFrom = lastCardId;
    let wrapped = false;

    let processed = run.processed;
    let failed = run.failed;
    let stalls = 0;

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
        if (wrapped || startedFrom === '') {
          completed = true;
          break;
        }

        wrapped = true;
        lastCardId = '';
        log('reached the end of the catalog, wrapping to the start');
        continue;
      }

      // Comparing ids in JS matches `ORDER BY id` only because the cluster is created with
      // --locale=C (byte order); an ICU collation orders `sm3-9` and `sm35-1` differently.
      const ids = wrapped
        ? rows.map((row) => row.id).filter((id) => id <= startedFrom)
        : rows.map((row) => row.id);

      if (ids.length === 0) {
        completed = true;
        lastCardId = startedFrom;
        break;
      }

      const batchEnd = ids[ids.length - 1] as string;
      const lastOfPass = wrapped && batchEnd >= startedFrom;

      let outcome: BatchOutcome;

      try {
        outcome = await this.runBatch(ids, choice, run.id, stalls);
      } catch (error) {
        await this.runs.close(run.id, SyncStatus.FAILED, describe(error));
        throw error;
      }

      if (outcome.stalled) {
        stalls += 1;

        if (stalls >= this.maxStalls) {
          stoppedBecause = `rate limited ${stalls} times consecutively`;
          break;
        }

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

    // Not redundant: the only cursor write when the budget or the stall ceiling stops the run
    // before any batch, and after a completed wrap - without it the next run re-sweeps below
    // `startedFrom`.
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

  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, error: Error): Promise<void> {
    await this.runs.closeIfFinallyFailed(SyncKind.PRICE, job, error);
  }

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
        const wait =
          error.retryAfterMs !== null
            ? Math.min(error.retryAfterMs, STALL_CAP_MS)
            : Math.min(STALL_BASE_MS * 2 ** stalls, STALL_CAP_MS);
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
