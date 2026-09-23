import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CardPriceSchema,
  PriceHistorySchema,
  type CardPrice,
  type PriceHistory,
  type PricePoint,
} from '@pokedrop/shared';
import { PriceSource } from '@prisma/client';
import { PrismaService } from '../prisma/index.js';
import { CacheService, cacheKeys } from '../redis/index.js';

/**
 * Prisma returns `Decimal` for the price columns, and JSON.stringify turns a
 * Decimal into a string - which then fails the response schema. PD-46 measured
 * what missing this costs: the schema rejected every cached row and the cache
 * silently never served one, presenting as mild slowness rather than an error.
 *
 * Duplicated from catalog.service.ts rather than shared, the way
 * catalog.writer.ts and price.writer.ts sit beside each other: three lines are
 * worth less than the module boundary.
 */
function toNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

const MS_PER_DAY = 86_400_000;

@Injectable()
export class PricesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * The first reader of `cache:price:card:{id}`.
   *
   * PD-48 delete it after every batch, and PD-49 and PD-50 reach the same delete
   * through PriceBatchService - so three invalidation sites have been deleting a
   * key nothing ever created. This closes that loop without adding a fourth
   * obligation anywhere.
   *
   * The schema is load-bearing rather than decoration: JSON has no date type, so
   * without it a warm read returns priceUpdatedAt as a string where a cold read
   * returns a Date, and the two responses stop being identical.
   */
  async getLatest(cardId: string): Promise<CardPrice> {
    return this.cache.getOrSet(
      cacheKeys.cardPrice(cardId),
      this.cache.ttl.cardPrice,
      async () => {
        const row = await this.prisma.card.findUnique({
          where: { id: cardId },
          select: { id: true, latestPriceUsd: true, latestPriceEur: true, priceUpdatedAt: true },
        });

        // Throwing from inside the loader is what keeps absence uncached:
        // getOrSet rejects and stores nothing. A 404 is one primary-key lookup,
        // and caching negatives invites filling the cache with invented ids.
        if (row === null) {
          throw new NotFoundException('Card not found');
        }

        // A card that exists but was never priced returns nulls, not a 404, and
        // this object caches normally - it is an object with null fields rather
        // than a null response, which getOrSet could not store.
        return CardPriceSchema.parse({
          cardId: row.id,
          usd: toNumber(row.latestPriceUsd),
          eur: toNumber(row.latestPriceEur),
          priceUpdatedAt: row.priceUpdatedAt,
        });
      },
      CardPriceSchema,
    );
  }

  /**
   * Not cached, and that is a decision rather than an omission.
   *
   * A fourth cache key would oblige PriceBatchService - and through it all three
   * jobs that call it - to delete a third key per card, for a query that reads at
   * most a few dozen rows through a covering index. The daily cap also means a
   * card's series changes at most once per source per day, so the cache would
   * mostly serve bytes it would have computed anyway. The ticket asks for caching
   * on the latest price only.
   */
  async getHistory(cardId: string, days: number): Promise<PriceHistory> {
    // The existence check is its own query rather than a join, so that a card
    // with no snapshots is still told apart from a card that does not exist -
    // both would otherwise produce zero rows and the same empty answer.
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: { id: true },
    });

    if (card === null) {
      throw new NotFoundException('Card not found');
    }

    const since = new Date(Date.now() - days * MS_PER_DAY);

    // Ranged on capturedAt because (cardId, capturedAt) is the index that serves
    // it; reported as capturedOn, which is the UTC day a daily sparkline plots.
    //
    // `market: { not: null }` is the no-interpolation rule expressed in SQL: a
    // snapshot carrying no market value is not a point, so it never reaches the
    // series rather than arriving as a null the client has to skip.
    const rows = await this.prisma.priceSnapshot.findMany({
      where: { cardId, capturedAt: { gte: since }, market: { not: null } },
      select: { source: true, capturedOn: true, market: true },
      orderBy: { capturedAt: 'asc' },
    });

    // Both keys always, each with its currency fixed by its source. An empty
    // series has no row to read a currency from, and a field that appears only
    // when data happens to exist is one a client cannot rely on.
    const series = {
      [PriceSource.TCGPLAYER]: { currency: 'USD', points: [] as PricePoint[] },
      [PriceSource.CARDMARKET]: { currency: 'EUR', points: [] as PricePoint[] },
    };

    for (const row of rows) {
      series[row.source].points.push({
        capturedOn: row.capturedOn.toISOString().slice(0, 10),
        market: Number(row.market),
      });
    }

    return PriceHistorySchema.parse({ cardId, windowDays: days, series });
  }
}
