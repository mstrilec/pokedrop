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

/**
 * Keyset pagination over our own `cards` table, not a provider's list.
 *
 * `{ lastCardId }` rather than `{ offset }`: it rides the primary key, stays
 * correct when cards are inserted or removed between runs, and does not degrade
 * at the far end of a 20 670-row catalog the way OFFSET does. The catalog sync's
 * cursor is a page number because it paginates a provider's list and has no
 * stable key to hold; this one does.
 *
 * The empty string is the start. Every card id sorts above it, so `id > ''`
 * is the first page with no special case in the query.
 */
export type PriceCursor = {
  lastCardId: string;
};

export type SyncCursor = CatalogCursor | PriceCursor;

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
   * The RUNNING row this job already owns, if there is one.
   *
   * Separate from startOrResume because the caller has to know *before* it
   * chooses a provider: a resumed run must keep the one its row names.
   */
  async findResumable(kind: SyncKind, jobId: string): Promise<SyncRun | null> {
    return this.prisma.syncRun.findFirst({
      where: { kind, status: SyncStatus.RUNNING, jobId },
      orderBy: { startedAt: 'desc' },
    });
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

  /** Reads the cursor a resumed run left behind, defaulting to the first page. */
  readCursor(run: SyncRun): CatalogCursor {
    const cursor = run.cursor as CatalogCursor | null;
    return cursor && typeof cursor.page === 'number' ? cursor : { page: 1 };
  }

  /** The price cursor a resumed run left behind, defaulting to the start. */
  readPriceCursor(run: SyncRun): PriceCursor {
    const cursor = run.cursor as PriceCursor | null;
    return cursor && typeof cursor.lastCardId === 'string' ? cursor : { lastCardId: '' };
  }

  /**
   * Where the previous *finished* run stopped - the position tonight's run
   * continues from.
   *
   * This is not resumption. A run that is still RUNNING is either in flight or
   * was abandoned by a killed process, and adopting either one's position would
   * mean two runs sweeping the same cards while a third of the catalog goes
   * untouched. Resuming a run this job already owns is `findResumable`'s job and
   * keys on the job id; this keys on nothing but recency.
   *
   * Defaults to the start, which is what an empty sync_runs table means: the
   * first sweep this project has ever run begins at the first card.
   */
  async lastClosedCursor(kind: SyncKind): Promise<PriceCursor> {
    const previous = await this.prisma.syncRun.findFirst({
      where: { kind, status: { not: SyncStatus.RUNNING } },
      orderBy: { startedAt: 'desc' },
    });

    return previous === null ? { lastCardId: '' } : this.readPriceCursor(previous);
  }
}
