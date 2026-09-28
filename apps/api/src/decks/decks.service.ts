import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DeckDetailSchema,
  DeckPageSchema,
  type CreateDeck,
  type DeckCardInput,
  type DeckDetail,
  type DeckListQuery,
  type DeckPage,
  type UpdateDeck,
} from '@pokedrop/shared';
import { CARD_SUMMARY_SELECT, toCardSummary } from '../common/card-summary.js';
import { assertOwner } from '../common/ownership.js';
import type { AuthUser } from '../common/request-auth.js';
import { PrismaService, type TransactionClient } from '../prisma/index.js';

const DETAIL_SELECT = {
  id: true,
  userId: true,
  name: true,
  format: true,
  isPublic: true,
  createdAt: true,
  updatedAt: true,
  cards: {
    orderBy: { cardId: 'asc' },
    select: { cardId: true, count: true, card: { select: CARD_SUMMARY_SELECT } },
  },
} satisfies Prisma.DeckSelect;

type DetailRow = Prisma.DeckGetPayload<{ select: typeof DETAIL_SELECT }>;

type Visibility = { userId: string; isPublic: boolean };

@Injectable()
export class DecksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: DeckListQuery): Promise<DeckPage> {
    const where: Prisma.DeckWhereInput = { userId };

    const [rows, total] = await Promise.all([
      this.prisma.deck.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.deck.count({ where }),
    ]);

    const sums = await this.prisma.deckCard.groupBy({
      by: ['deckId'],
      where: { deckId: { in: rows.map((row) => row.id) } },
      _sum: { count: true },
    });
    const cardCounts = new Map(sums.map((sum) => [sum.deckId, sum._sum.count ?? 0]));

    return DeckPageSchema.parse({
      items: rows.map((row) => ({ ...row, cardCount: cardCounts.get(row.id) ?? 0 })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    });
  }

  async get(id: string, viewer: AuthUser | undefined): Promise<DeckDetail> {
    const row = await this.prisma.deck.findUnique({ where: { id }, select: DETAIL_SELECT });
    assertVisible(row, viewer);
    return toDetail(row);
  }

  create(user: AuthUser, input: CreateDeck): Promise<DeckDetail> {
    return this.prisma.withTransaction(async (tx) => {
      await assertCardsExist(tx, input.cards);

      const row = await tx.deck.create({
        data: {
          userId: user.id,
          name: input.name,
          format: input.format,
          isPublic: input.isPublic,
          cards: { createMany: { data: input.cards } },
        },
        select: DETAIL_SELECT,
      });

      return toDetail(row);
    });
  }

  update(user: AuthUser, id: string, patch: UpdateDeck): Promise<DeckDetail> {
    return this.prisma.withTransaction(async (tx) => {
      const deck = await tx.deck.findUnique({
        where: { id },
        select: { userId: true, isPublic: true },
      });
      assertVisible(deck, user);
      assertOwner(deck.userId, user);

      if (patch.cards !== undefined) {
        await assertCardsExist(tx, patch.cards);
      }

      // The deck row is written before its cards, so its row lock serialises
      // two saves of one deck - the second waits and replaces the first
      // rather than colliding with it on (deckId, cardId).
      await tx.deck.update({
        where: { id },
        data: {
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.format === undefined ? {} : { format: patch.format }),
          ...(patch.isPublic === undefined ? {} : { isPublic: patch.isPublic }),
          updatedAt: new Date(),
        },
      });

      if (patch.cards !== undefined) {
        await tx.deckCard.deleteMany({ where: { deckId: id } });
        await tx.deckCard.createMany({
          data: patch.cards.map((card) => ({ deckId: id, ...card })),
        });
      }

      return toDetail(await tx.deck.findUniqueOrThrow({ where: { id }, select: DETAIL_SELECT }));
    });
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const deck = await this.prisma.deck.findUnique({
      where: { id },
      select: { userId: true, isPublic: true },
    });
    assertVisible(deck, user);
    assertOwner(deck.userId, user);

    await this.prisma.deck.delete({ where: { id } });
  }
}

/**
 * A private deck is a 404 to everyone but its owner, never a 403, so a deck id
 * cannot be probed for existence. A public deck exists for anyone to see, so a
 * stranger's edit to it is refused by `assertOwner` with an honest 403.
 */
function assertVisible<T extends Visibility>(
  deck: T | null,
  viewer: AuthUser | undefined,
): asserts deck is T {
  if (deck === null || (!deck.isPublic && deck.userId !== viewer?.id)) {
    throw new NotFoundException('Deck not found');
  }
}

async function assertCardsExist(tx: TransactionClient, cards: DeckCardInput[]): Promise<void> {
  if (cards.length === 0) {
    return;
  }

  const ids = cards.map((card) => card.cardId);
  const found = await tx.card.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const known = new Set(found.map((card) => card.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new BadRequestException(`Unknown card: ${unknown.join(', ')}`);
  }
}

function toDetail(row: DetailRow): DeckDetail {
  return DeckDetailSchema.parse({
    ...row,
    cards: row.cards.map((entry) => ({
      cardId: entry.cardId,
      count: entry.count,
      card: toCardSummary(entry.card),
    })),
  });
}
