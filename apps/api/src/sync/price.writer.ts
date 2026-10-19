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
 * UTC, load-bearing: `capturedOn` is half of the one-snapshot-per-day unique key, and two
 * processes that disagree about where a day begins would admit a second row.
 */
export function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

@Injectable()
export class PriceWriter {
  /**
   * `updateMany`, not `update`: a card deleted since enqueueing costs zero rows instead of a P2025
   * that aborts the whole batch's transaction.
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
   * `skipDuplicates` is the whole daily cap: ON CONFLICT DO NOTHING against
   * (cardId, source, capturedOn).
   */
  async insertSnapshots(tx: TransactionClient, rows: SnapshotRow[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const result = await tx.priceSnapshot.createMany({ data: rows, skipDuplicates: true });
    return result.count;
  }
}
