import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { PrismaService } from '../prisma/index.js';

export interface ActiveCardSelection {
  cardIds: string[];

  /** True when more cards were eligible than the bound allows. */
  truncated: boolean;
}

const MS_PER_DAY = 86_400_000;

/**
 * Which cards the active refresh should price, and in what order.
 *
 * One statement, and it satisfies three of the ticket's criteria at once.
 *
 * **Deduplication against the nightly sweep is free.** A card that sweep
 * refreshed carries a fresh `priceUpdatedAt`, so the freshness predicate
 * excludes it until the window passes. There is no run registry and no Redis
 * marker: the column PD-48 already writes is the entire mechanism, which means
 * there is no shared state between the two jobs that could fall out of step.
 *
 * **Ordering is staleness, oldest first.** The ticket asks for the most-viewed
 * cards first; view tracking is deferred to its own ticket because no traffic
 * exists to shape it, and staleness is the honest replacement - it is the
 * ordering a refresh job wants anyway.
 *
 * Raw SQL because the membership test is a UNION of three tables and Prisma's
 * query builder cannot express one. Every interpolation below is a tagged
 * template parameter, not string concatenation.
 */
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

    // One more than the bound, so truncation is detectable. A bare LIMIT
    // returning exactly `maxCards` cannot tell "there were this many" from
    // "there were more", and a second COUNT(*) would run the membership union
    // twice to learn one boolean.
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
