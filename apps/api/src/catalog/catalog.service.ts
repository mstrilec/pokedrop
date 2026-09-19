import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  CardSchema,
  CardSetSchema,
  SetDetailSchema,
  type Card,
  type CardSearchQuery,
  type CardSearchResult,
  type CardSet,
  type SetDetail,
} from '@pokedrop/shared';
import { PrismaService } from '../prisma/index.js';
import { CacheService, cacheKeys } from '../redis/index.js';

const CardSetListSchema = z.array(CardSetSchema);

/**
 * Prisma returns a Decimal for the two price columns, and JSON.stringify turns
 * that into a string - so the API was answering `"15.60"` where CardSchema
 * promises a number. Decimal(10,2) fits a JS number exactly, so converting at
 * this boundary is lossless.
 *
 * Caught by PD-46's byte-identity check rather than by anything in PD-45: the
 * cache round trip is what made the contract violation visible.
 */
function toNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Every row leaves through its schema, so a cold read and a warm one are the
 * same bytes by construction rather than by coincidence. It also stops columns
 * the contract does not declare - `updatedAt` - leaking on a cold read only.
 */
function toCard(row: Record<string, unknown>): Card {
  return CardSchema.parse({
    ...row,
    latestPriceUsd: toNumber(row.latestPriceUsd),
    latestPriceEur: toNumber(row.latestPriceEur),
  });
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Deliberately uncached. The TTL table in docs/Architecture.md section 8 names
   * card:{id}, sets, set:{id} and facets - and no search key, because a filter
   * combination has high cardinality and a low hit rate, so caching one mostly
   * fills Redis with entries nobody asks for twice.
   */
  async searchCards(query: CardSearchQuery): Promise<CardSearchResult> {
    const where: Prisma.CardWhereInput = {
      ...(query.set === undefined ? {} : { setId: query.set }),
      ...(query.rarity === undefined ? {} : { rarity: query.rarity }),
      ...(query.type === undefined ? {} : { types: { has: query.type } }),
      ...(query.q === undefined ? {} : { name: { contains: query.q, mode: 'insensitive' } }),
    };

    // `id` is not decoration. 16 216 of 20 670 rows share a name, so without a
    // tiebreak PostgreSQL may order ties differently between two requests and
    // offset pagination then shows one row twice and another never.
    const orderBy: Prisma.CardOrderByWithRelationInput[] =
      query.sort === 'name_desc'
        ? [{ name: 'desc' }, { id: 'desc' }]
        : [{ name: 'asc' }, { id: 'asc' }];

    const [items, total] = await Promise.all([
      this.prisma.card.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.card.count({ where }),
    ]);

    return {
      items: items.map((row) => toCard(row as unknown as Record<string, unknown>)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async getCard(id: string): Promise<Card> {
    // The schema is load-bearing, not decoration. JSON has no date type, so
    // without it a warm read returns `priceUpdatedAt` as a string where a cold
    // read returns a Date, and the two responses stop being identical.
    //
    // A missing card throws from inside the loader, so getOrSet rejects and
    // caches nothing - which is the behaviour wanted. Absence stays uncached: a
    // 404 is one primary-key lookup, and caching negatives invites filling the
    // cache with invented ids.
    return this.cache.getOrSet(
      cacheKeys.card(id),
      this.cache.ttl.card,
      async () => {
        const card = await this.prisma.card.findUnique({ where: { id } });

        if (card === null) {
          throw new NotFoundException('Card not found');
        }

        return toCard(card);
      },
      CardSchema,
    );
  }

  async listSets(): Promise<CardSet[]> {
    return this.cache.getOrSet(
      cacheKeys.sets(),
      this.cache.ttl.sets,
      async () => {
        // Unpaginated on purpose: 176 rows that grow by a handful a year.
        const sets = await this.prisma.cardSet.findMany({
          orderBy: [{ releaseDate: 'desc' }, { id: 'asc' }],
        });

        return CardSetListSchema.parse(sets);
      },
      CardSetListSchema,
    );
  }

  async getSet(id: string): Promise<SetDetail> {
    // `set:{id}` shares the `sets` TTL. docs/Architecture.md section 8 lists
    // them on one row for that reason, and cachePatterns.allSets() is the glob
    // `cache:set*`, which clears both.
    return this.cache.getOrSet(
      cacheKeys.set(id),
      this.cache.ttl.sets,
      () => this.loadSet(id),
      SetDetailSchema,
    );
  }

  private async loadSet(id: string): Promise<SetDetail> {
    const set = await this.prisma.cardSet.findUnique({
      where: { id },
      include: { _count: { select: { cards: true } } },
    });

    if (set === null) {
      throw new NotFoundException('Set not found');
    }

    const { _count, ...rest } = set;

    // `cardCount` is what the mirror holds; `total` is what the provider says
    // the set contains. They differ while a sync is still filling in pages.
    return SetDetailSchema.parse({ ...rest, cardCount: _count.cards });
  }
}
