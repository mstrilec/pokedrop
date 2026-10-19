import { Injectable, Logger } from '@nestjs/common';
import { SyncKind, SyncStatus, type SyncRun } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/index.js';

export type CatalogCursor = {
  page: number;
};

export type PriceCursor = {
  lastCardId: string;
};

export type SyncCursor = CatalogCursor | PriceCursor;

@Injectable()
export class SyncRunService {
  private readonly logger = new Logger(SyncRunService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The jobId match is what makes resuming safe: a BullMQ retry keeps its job id, so a retry
   * resumes and a new job never adopts a run abandoned by a killed process.
   */
  async startOrResume(kind: SyncKind, provider: string, jobId: string): Promise<SyncRun> {
    const existing = await this.prisma.syncRun.findFirst({
      where: { kind, status: SyncStatus.RUNNING, jobId },
      orderBy: { startedAt: 'desc' },
    });

    if (existing) {
      this.logger.log(`Resuming sync run ${existing.id} from ${JSON.stringify(existing.cursor)}`);
      return existing;
    }

    return this.prisma.syncRun.create({ data: { kind, provider, jobId } });
  }

  async findResumable(kind: SyncKind, jobId: string): Promise<SyncRun | null> {
    return this.prisma.syncRun.findFirst({
      where: { kind, status: SyncStatus.RUNNING, jobId },
      orderBy: { startedAt: 'desc' },
    });
  }

  async recordProgress(
    id: string,
    processed: number,
    failed: number,
    cursor: SyncCursor,
  ): Promise<void> {
    await this.prisma.syncRun.update({
      where: { id },
      data: { processed, failed, cursor },
    });
  }

  async close(id: string, status: SyncStatus, error?: string): Promise<void> {
    await this.prisma.syncRun.update({
      where: { id },
      data: { status, finishedAt: new Date(), error: error ?? null },
    });
  }

  async closeIfFinallyFailed(kind: SyncKind, job: Job | undefined, error: Error): Promise<void> {
    if (job?.id === undefined) {
      return;
    }
    try {
      if ((await job.getState()) !== 'failed') {
        return;
      }
      const { count } = await this.prisma.syncRun.updateMany({
        where: { kind, jobId: job.id, status: SyncStatus.RUNNING },
        data: {
          status: SyncStatus.FAILED,
          finishedAt: new Date(),
          error: `job failed after ${job.attemptsMade} attempts: ${error.message}`,
        },
      });
      if (count > 0) {
        this.logger.warn(`job ${job.id}: closed its ${kind} run as FAILED - ${error.message}`);
      }
    } catch (closeError) {
      this.logger.error(
        `job ${job.id}: could not close its ${kind} run - ${closeError instanceof Error ? closeError.message : String(closeError)}`,
      );
    }
  }

  readCursor(run: SyncRun): CatalogCursor {
    const cursor = run.cursor as CatalogCursor | null;
    return cursor && typeof cursor.page === 'number' ? cursor : { page: 1 };
  }

  readPriceCursor(run: SyncRun): PriceCursor {
    const cursor = run.cursor as PriceCursor | null;
    return cursor && typeof cursor.lastCardId === 'string' ? cursor : { lastCardId: '' };
  }

  async lastClosedCursor(kind: SyncKind): Promise<PriceCursor> {
    const previous = await this.prisma.syncRun.findFirst({
      where: { kind, status: { not: SyncStatus.RUNNING } },
      orderBy: { startedAt: 'desc' },
    });

    return previous === null ? { lastCardId: '' } : this.readPriceCursor(previous);
  }
}
