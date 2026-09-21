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

/**
 * One batch, end to end. Lifted out of PriceSyncProcessor so that PD-49's sweep
 * and PD-48's processor reach the same write path rather than two copies of it:
 * PD-48 promised one write path and three producers, and this is what makes
 * that literally true now that one of the producers does not enqueue.
 */
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

    // Only ids this batch asked for. Under failover the response's cardId is
    // TCGdex's vocabulary - `sv04-25` where this mirror holds `sv4-25` - and
    // writing one would raise P2025 out of the transaction and cost the whole
    // batch rather than the row that caused it. It is also what keeps prices
    // unable to fork the catalog: every id that reaches the writer came out of
    // our own database.
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
      // A currency this response did not carry becomes null rather than keeping
      // its previous value. There is one priceUpdatedAt for both columns, so a
      // stale EUR beside a fresh USD would make that timestamp true of one and
      // false of the other with no way for a reader to tell which.
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

    // A card absent from the response is absent from `updates`, so it is not
    // touched at all - not its columns, not its timestamp, not a snapshot. That
    // is the difference between "no new price" and "the price is now nothing",
    // and it is why this loop runs over the response rather than over cardIds.
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
   * Both keys, because both carry the price and each path used to assume the
   * other owned it.
   *
   * `cache:price:card:{id}` is the obvious one. `cache:card:{id}` is the whole
   * card payload, and CatalogService builds it from the row including
   * latestPriceUsd, latestPriceEur and priceUpdatedAt - so leaving it behind
   * serves the pre-run price from `GET /cards/:id` for up to its 24-hour TTL
   * while `GET /cards/:id/price` serves the new one. Two numbers for one card.
   *
   * After the commit, never inside it: a Redis round trip inside an open
   * transaction holds row locks for the length of a network call.
   *
   * Per card, never cachePatterns.allPrices() - a batch of 250 must not flush
   * the other 20 420 cards' prices.
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

  /**
   * Only ProviderUnavailableError and ProviderContractError feed the breaker. A
   * ProviderRateLimitError says the upstream is healthy and we are asking too
   * fast; counting it would move load onto the fallback and rate-limit that one
   * too. The same rule sync/README.md, http.ts and the catalog processor state.
   */
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
