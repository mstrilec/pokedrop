import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { PriceSource } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/index.js';
import { QUEUE } from '../queue/index.js';
import { CacheService, cacheKeys } from '../redis/index.js';
import {
  ProviderBreakerService,
  ProviderContractError,
  ProviderSelectorService,
  ProviderUnavailableError,
  type CardSourceName,
  type PriceDTO,
} from './providers/index.js';
import { PriceWriter, startOfUtcDay, type LatestPrice, type SnapshotRow } from './price.writer.js';

/**
 * The contract three producers speak: PD-49 enqueues batches covering the
 * catalog, PD-50 the active set, PD-52 a single card. All the selection logic
 * lives in the schedules; this processor is handed ids and does not choose
 * them.
 */
export interface PriceSyncJob {
  cardIds: string[];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Processor(QUEUE.priceSync)
export class PriceSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(PriceSyncProcessor.name);

  constructor(
    private readonly selector: ProviderSelectorService,
    private readonly breaker: ProviderBreakerService,
    private readonly prisma: PrismaService,
    private readonly writer: PriceWriter,
    private readonly cache: CacheService,
  ) {
    super();
  }

  async process(job: Job<PriceSyncJob>): Promise<void> {
    const { cardIds } = job.data;

    if (cardIds.length === 0) {
      return;
    }

    const choice = await this.selector.select();
    const provider = choice.provider;

    const points = await this.fetch(provider.name, () => provider.fetchPrices(cardIds));
    await this.breaker.recordSuccess(provider.name);

    // One instant for the whole job, so every row shares a day by
    // construction. The DTO carries its own capturedAt from the moment the
    // client made the call; the difference is milliseconds, and one value here
    // is what keeps `capturedOn` consistent across the batch.
    const capturedAt = new Date();
    const capturedOn = startOfUtcDay(capturedAt);

    const byCard = new Map<string, PriceDTO[]>();
    for (const point of points) {
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
      // A currency this response did not carry becomes null rather than
      // keeping its previous value. There is one priceUpdatedAt for both
      // columns, so a stale EUR beside a fresh USD would make that timestamp
      // true of one and false of the other with no way to tell which.
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
    // touched at all - not its columns, not its timestamp, not a snapshot.
    // That is the difference between "no new price" and "the price is now
    // nothing", and it is why this loop runs over the response rather than
    // over cardIds.
    const written = await this.prisma.withTransaction(async (tx) => {
      const cards = await this.writer.updateLatest(tx, updates);
      const rows = await this.writer.insertSnapshots(tx, snapshots);
      return { cards, rows };
    });

    // After the commit, never inside it: a Redis round trip inside an open
    // transaction holds row locks for the length of a network call.
    //
    // Per card, never cachePatterns.allPrices() - a batch of 100 must not
    // flush the other 20 570 cards' prices.
    await this.cache.del(...updates.map((update) => cacheKeys.cardPrice(update.cardId)));

    this.logger.log(
      `job ${job.id}: ${cardIds.length} asked, ${byCard.size} priced by ${provider.name}, ` +
        `${written.cards} cards updated, ${written.rows} snapshots written`,
    );
  }

  /**
   * Only ProviderUnavailableError and ProviderContractError feed the breaker.
   * A ProviderRateLimitError says the upstream is healthy and we are asking too
   * fast; counting it would move load onto the fallback and rate-limit that one
   * too. The same rule sync/README.md and http.ts already state.
   */
  private async fetch(name: CardSourceName, call: () => Promise<PriceDTO[]>): Promise<PriceDTO[]> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof ProviderUnavailableError || error instanceof ProviderContractError) {
        const count = await this.breaker.recordFailure(name);
        this.logger.warn(`price fetch failed (${count} consecutive) - ${describe(error)}`);
      } else {
        this.logger.warn(`price fetch failed locally - ${describe(error)}`);
      }

      throw error;
    }
  }
}
