import { Injectable, Logger } from '@nestjs/common';
import { PriceSource } from '@prisma/client';
import { PrismaService } from '../prisma/index.js';
import { CacheService, cacheKeys } from '../redis/index.js';
import {
  ProviderBreakerService,
  ProviderContractError,
  ProviderUnavailableError,
  type CardSourceProvider,
  type PriceDTO,
} from './providers/index.js';
import { PriceWriter, startOfUtcDay, type LatestPrice, type SnapshotRow } from './price.writer.js';

export interface BatchResult {
  asked: number;
  priced: number;
  cards: number;
  snapshots: number;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class PriceBatchService {
  private readonly logger = new Logger(PriceBatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: PriceWriter,
    private readonly cache: CacheService,
    private readonly breaker: ProviderBreakerService,
  ) {}

  async refreshBatch(cardIds: string[], provider: CardSourceProvider): Promise<BatchResult> {
    if (cardIds.length === 0) {
      return { asked: 0, priced: 0, cards: 0, snapshots: 0 };
    }

    const points = await this.fetch(provider, cardIds);
    await this.breaker.recordSuccess(provider.name);

    // One instant for the whole batch, so every row shares a day by
    // construction and `capturedOn` cannot straddle midnight within one job.
    const capturedAt = new Date();
    const capturedOn = startOfUtcDay(capturedAt);

    // Only ids this batch asked for: under failover the response's ids are TCGdex's (`sv04-25` for
    // `sv4-25`), and writing one would abort the batch and fork the catalog.
    const asked = new Set(cardIds);

    const byCard = new Map<string, PriceDTO[]>();
    for (const point of points) {
      if (!asked.has(point.cardId)) {
        continue;
      }

      const existing = byCard.get(point.cardId);
      if (existing) {
        existing.push(point);
      } else {
        byCard.set(point.cardId, [point]);
      }
    }

    const updates: LatestPrice[] = [];
    const snapshots: SnapshotRow[] = [];

    for (const [cardId, forCard] of byCard) {
      const usd = forCard.find((p) => p.source === PriceSource.TCGPLAYER)?.market ?? null;
      const eur = forCard.find((p) => p.source === PriceSource.CARDMARKET)?.market ?? null;

      updates.push({ cardId, usd, eur, capturedAt });

      for (const point of forCard) {
        snapshots.push({
          cardId: point.cardId,
          source: point.source,
          currency: point.currency,
          market: point.market,
          low: point.low,
          mid: point.mid,
          high: point.high,
          capturedAt,
          capturedOn,
        });
      }
    }

    const written = await this.prisma.withTransaction(async (tx) => {
      const cards = await this.writer.updateLatest(tx, updates);
      const rows = await this.writer.insertSnapshots(tx, snapshots);
      return { cards, rows };
    });

    await this.invalidate(updates.map((update) => update.cardId));

    return {
      asked: cardIds.length,
      priced: byCard.size,
      cards: written.cards,
      snapshots: written.rows,
    };
  }

  /**
   * Both keys: `cache:card:{id}` carries the price too. After the commit, never inside it, and per
   * card - never cachePatterns.allPrices().
   */
  private async invalidate(cardIds: string[]): Promise<void> {
    if (cardIds.length === 0) {
      return;
    }

    await this.cache.del(
      ...cardIds.map((id) => cacheKeys.cardPrice(id)),
      ...cardIds.map((id) => cacheKeys.card(id)),
    );
  }

  /** A ProviderRateLimitError must not feed the breaker: it would shift load to the fallback. */
  private async fetch(provider: CardSourceProvider, cardIds: string[]): Promise<PriceDTO[]> {
    try {
      return await provider.fetchPrices(cardIds);
    } catch (error) {
      if (error instanceof ProviderUnavailableError || error instanceof ProviderContractError) {
        const count = await this.breaker.recordFailure(provider.name);
        this.logger.warn(`price fetch failed (${count} consecutive) - ${describe(error)}`);
      } else {
        this.logger.warn(`price fetch failed locally - ${describe(error)}`);
      }

      throw error;
    }
  }
}
