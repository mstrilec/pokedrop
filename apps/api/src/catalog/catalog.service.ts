import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Card, CardSearchQuery, CardSearchResult, CardSet, SetDetail } from '@pokedrop/shared';
import { PrismaService } from '../prisma/index.js';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

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
      items: items as unknown as Card[],
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async getCard(id: string): Promise<Card> {
    const card = await this.prisma.card.findUnique({ where: { id } });

    if (card === null) {
      // Absence is not cached and not represented as an empty body. A 404 is one
      // indexed primary-key lookup, and caching a negative invites filling the
      // cache with invented ids.
      throw new NotFoundException('Card not found');
    }

    return card as unknown as Card;
  }

  async listSets(): Promise<CardSet[]> {
    // Unpaginated on purpose: 176 rows that grow by a handful a year.
    const sets = await this.prisma.cardSet.findMany({
      orderBy: [{ releaseDate: 'desc' }, { id: 'asc' }],
    });

    return sets as unknown as CardSet[];
  }

  async getSet(id: string): Promise<SetDetail> {
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
    return { ...rest, cardCount: _count.cards } as unknown as SetDetail;
  }
}
