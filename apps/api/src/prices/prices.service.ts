import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CardPriceSchema,
  PriceHistorySchema,
  type CardPrice,
  type PriceHistory,
  type PricePoint,
} from '@pokedrop/shared';
import { PriceSource } from '@prisma/client';
import { toNumber } from '../common/decimal.js';
import { PrismaService } from '../prisma/index.js';
import { CacheService, cacheKeys } from '../redis/index.js';

const MS_PER_DAY = 86_400_000;

@Injectable()
export class PricesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * The schema is load-bearing: without it a warm read returns priceUpdatedAt as a string where a
   * cold read returns a Date.
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

        if (row === null) {
          throw new NotFoundException('Card not found');
        }

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

  async getHistory(cardId: string, days: number): Promise<PriceHistory> {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: { id: true },
    });

    if (card === null) {
      throw new NotFoundException('Card not found');
    }

    const since = new Date(Date.now() - days * MS_PER_DAY);

    const rows = await this.prisma.priceSnapshot.findMany({
      where: { cardId, capturedAt: { gte: since }, market: { not: null } },
      select: { source: true, capturedOn: true, market: true },
      orderBy: { capturedAt: 'asc' },
    });

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
