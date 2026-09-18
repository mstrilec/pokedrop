import { Injectable, Logger } from '@nestjs/common';
import { SyncKind, SyncStatus, type SyncRun } from '@prisma/client';
import { PrismaService } from '../prisma/index.js';

/**
 * A type alias rather than an interface: Prisma's `InputJsonValue` requires an
 * index signature, and an interface does not get one implicitly.
 */
export type CatalogCursor = {
  page: number;
};

@Injectable()
export class SyncRunService {
  private readonly logger = new Logger(SyncRunService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Continues the run this job already started, or begins a new one.
   *
   * The jobId match is what makes that safe. Adopting any RUNNING row would
   * mean a fresh processor picking up a run abandoned a week ago by a process
   * that was killed, and resuming from a cursor that no longer means anything.
   * A BullMQ retry keeps the same job id, so a retry resumes and a new job
   * starts clean.
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

  /**
   * Written once per page rather than buffered. 83 small updates a sweep is
   * immaterial beside 20 670 upserts, and buffering means a crash loses exactly
   * the cursor that made resuming possible.
   */
  async recordProgress(
    id: string,
    processed: number,
    failed: number,
    cursor: CatalogCursor,
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

  /** Reads the cursor a resumed run left behind, defaulting to the first page. */
  readCursor(run: SyncRun): CatalogCursor {
    const cursor = run.cursor as CatalogCursor | null;
    return cursor && typeof cursor.page === 'number' ? cursor : { page: 1 };
  }
}
