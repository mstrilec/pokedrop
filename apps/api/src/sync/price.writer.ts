import { Injectable } from '@nestjs/common';
import type { PriceSource } from '@prisma/client';
import type { TransactionClient } from '../prisma/index.js';

export interface LatestPrice {
  cardId: string;
  usd: number | null;
  eur: number | null;
  capturedAt: Date;
}

export interface SnapshotRow {
  cardId: string;
  source: PriceSource;
  currency: string;
  market: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
  capturedAt: Date;
  capturedOn: Date;
}

/**
 * The UTC day `at` falls in.
 *
 * UTC rather than local time is load-bearing. `capturedOn` is half of the
 * unique key that caps a card at one snapshot per source per day, so if two
 * processes disagreed about where a day begins the cap would admit a second
 * row - and they would disagree the first time a server moved timezone or a
 * clock crossed a DST boundary.
 */
export function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * Where the price path writes. The sibling `catalog.writer.ts` is raw SQL
 * because a conditional-update upsert has no Prisma equivalent; nothing here
 * has that shape, so this one is ordinary Prisma.
 */
@Injectable()
export class PriceWriter {
  /**
   * One UPDATE per card rather than a single statement over a VALUES list.
   *
   * A price genuinely changes, so unlike the catalog sweep there is nothing to
   * guard against here - no dead tuples to avoid, no reason to compare before
   * writing. At a batch of 100 inside one transaction this is 100 statements on
   * an already-open connection, which the provider call in front of it dwarfs.
   *
   * `updateMany` rather than `update` is deliberate: a card deleted between a
   * job being enqueued and being processed then costs zero rows instead of
   * `update` raising P2025 and aborting the whole batch's transaction.
   */
  async updateLatest(tx: TransactionClient, rows: LatestPrice[]): Promise<number> {
    let written = 0;

    for (const row of rows) {
      const result = await tx.card.updateMany({
        where: { id: row.cardId },
        data: {
          latestPriceUsd: row.usd,
          latestPriceEur: row.eur,
          priceUpdatedAt: row.capturedAt,
        },
      });

      written += result.count;
    }

    return written;
  }

  /**
   * `skipDuplicates` is the whole cap.
   *
   * It compiles to ON CONFLICT DO NOTHING against the unique index on
   * (cardId, source, capturedOn), so a second run on the same day inserts
   * nothing and raises nothing - the database decides, not a check in front of
   * the write, and two concurrent workers get the same answer as one.
   */
  async insertSnapshots(tx: TransactionClient, rows: SnapshotRow[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const result = await tx.priceSnapshot.createMany({ data: rows, skipDuplicates: true });
    return result.count;
  }
}
