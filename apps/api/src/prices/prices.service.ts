import { Injectable, NotFoundException } from '@nestjs/common';
import { CardPriceSchema, type CardPrice } from '@pokedrop/shared';
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
}
