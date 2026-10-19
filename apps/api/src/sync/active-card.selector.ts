import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { PrismaService } from '../prisma/index.js';

export interface ActiveCardSelection {
  cardIds: string[];

  truncated: boolean;
}

const MS_PER_DAY = 86_400_000;

@Injectable()
export class ActiveCardSelector {
  private readonly freshnessMs: number;
  private readonly tradeWindowMs: number;
  private readonly maxCards: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.freshnessMs = config.priceActive.freshnessSeconds * 1_000;
    this.tradeWindowMs = config.priceActive.tradeWindowDays * MS_PER_DAY;
    this.maxCards = config.priceActive.maxCards;
  }

  async select(now: Date = new Date()): Promise<ActiveCardSelection> {
    const staleBefore = new Date(now.getTime() - this.freshnessMs);
    const tradedAfter = new Date(now.getTime() - this.tradeWindowMs);

    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id
      FROM cards c
      WHERE c.id IN (
              SELECT "cardId" FROM inventory_items
        UNION SELECT "cardId" FROM deck_cards
        UNION SELECT ti."cardId" FROM trade_items ti
                JOIN trades t ON t.id = ti."tradeId"
               WHERE t."createdAt" > ${tradedAfter}
            )
        AND (c."priceUpdatedAt" IS NULL OR c."priceUpdatedAt" < ${staleBefore})
      ORDER BY c."priceUpdatedAt" ASC NULLS FIRST
      LIMIT ${this.maxCards + 1}
    `;

    return {
      cardIds: rows.slice(0, this.maxCards).map((row) => row.id),
      truncated: rows.length > this.maxCards,
    };
  }
}
