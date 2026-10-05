import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DECK_NAME_MAX,
  DeckDetailSchema,
  DeckPageSchema,
  type CreateDeck,
  type DeckCardInput,
  type DeckDetail,
  type DeckListQuery,
  type DeckPage,
  type DeckSaveResult,
  type DeckStats,
  type DeckValidation,
  OwnDeckPageSchema,
  type OwnDeckPage,
  type UpdateDeck,
} from '@pokedrop/shared';
import { CARD_SUMMARY_SELECT, toCardSummary } from '../common/card-summary.js';
import { assertOwner } from '../common/ownership.js';
import type { AuthUser } from '../common/request-auth.js';
import { PrismaService, type TransactionClient } from '../prisma/index.js';
import { toDeckStats, type StatsRow } from './deck-stats.js';
import { DeckValidationService } from './deck-validation.service.js';

const DETAIL_SELECT = {
  id: true,
  userId: true,
  name: true,
  format: true,
  isPublic: true,
  ownedOnly: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { displayName: true } },
  cards: {
    orderBy: { cardId: 'asc' },
    select: { cardId: true, count: true, card: { select: CARD_SUMMARY_SELECT } },
  },
} satisfies Prisma.DeckSelect;

type DetailRow = Prisma.DeckGetPayload<{ select: typeof DETAIL_SELECT }>;

type Visibility = { userId: string; isPublic: boolean };

const COPY_SUFFIX = ' (copy)';

@Injectable()
export class DecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: DeckValidationService,
  ) {}

  /** The owner's decks, each with the verdict on it as saved — computed now, never stored. */
  async list(userId: string, query: DeckListQuery): Promise<OwnDeckPage> {
    const page = await this.page({ userId }, query);
    const verdicts = await Promise.all(
      page.items.map((deck) =>
        this.validation.validate(deck.id).catch((error: unknown) => {
          if (error instanceof NotFoundException) return null;
          throw error;
        }),
      ),
    );
    return OwnDeckPageSchema.parse({
      ...page,
      items: page.items
        .map((deck, index) => ({ deck, verdict: verdicts[index] }))
        // A deck deleted between the page read and its validation is left out, not failed.
        .filter(({ verdict }) => verdict !== null && verdict !== undefined)
        .map(({ deck, verdict }) => ({ ...deck, valid: verdict?.valid ?? false })),
    });
  }

  /** Another user's shelf: public decks only, and a 404 for a user that does not exist. */
  async listPublic(userId: string, query: DeckListQuery): Promise<DeckPage> {
    const owner = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (owner === null) {
      throw new NotFoundException('User not found');
    }
    return this.page({ userId, isPublic: true }, query);
  }

  async stats(id: string, viewer: AuthUser | undefined): Promise<DeckStats> {
    const deck = await this.prisma.deck.findUnique({
      where: { id },
      select: { userId: true, isPublic: true },
    });
    assertVisible(deck, viewer);

    const rows = await this.prisma.$queryRaw<StatsRow[]>`
      SELECT c.supertype, c.rarity, c.types, dc.count
      FROM deck_cards dc
      JOIN cards c ON c.id = dc."cardId"
      WHERE dc."deckId" = ${id}
    `;
    return toDeckStats(rows);
  }

  private async page(where: Prisma.DeckWhereInput, query: DeckListQuery): Promise<DeckPage> {
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

  private async saveResult(tx: TransactionClient, id: string): Promise<DeckSaveResult> {
    const validation = await this.validation.validate(id, tx);
    const row = await tx.deck.findUniqueOrThrow({ where: { id }, select: DETAIL_SELECT });
    return { ...toDetail(row), validation };
  }

  async get(id: string, viewer: AuthUser | undefined): Promise<DeckDetail> {
    const row = await this.prisma.deck.findUnique({ where: { id }, select: DETAIL_SELECT });
    assertVisible(row, viewer);
    return toDetail(row);
  }

  create(user: AuthUser, input: CreateDeck): Promise<DeckSaveResult> {
    return this.prisma.withTransaction(async (tx) => {
      await assertCardsExist(tx, input.cards);

      const row = await tx.deck.create({
        data: {
          userId: user.id,
          name: input.name,
          format: input.format,
          isPublic: input.isPublic,
          ownedOnly: input.ownedOnly,
          cards: { createMany: { data: input.cards } },
        },
        select: { id: true },
      });

      return this.saveResult(tx, row.id);
    });
  }

  update(user: AuthUser, id: string, patch: UpdateDeck): Promise<DeckSaveResult> {
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
          ...(patch.ownedOnly === undefined ? {} : { ownedOnly: patch.ownedOnly }),
          updatedAt: new Date(),
        },
      });

      if (patch.cards !== undefined) {
        await tx.deckCard.deleteMany({ where: { deckId: id } });
        await tx.deckCard.createMany({
          data: patch.cards.map((card) => ({ deckId: id, ...card })),
        });
      }

      return this.saveResult(tx, id);
    });
  }

  /**
   * Any deck the caller can see, so a stranger's public deck too. The copy is
   * private and asks nothing of the caller's inventory: owning its cards is
   * the validator's question, answered against the cloner's copies.
   */
  clone(user: AuthUser, id: string): Promise<DeckSaveResult> {
    return this.prisma.withTransaction(async (tx) => {
      const source = await tx.deck.findUnique({
        where: { id },
        select: {
          userId: true,
          isPublic: true,
          name: true,
          format: true,
          ownedOnly: true,
          cards: { select: { cardId: true, count: true } },
        },
      });
      assertVisible(source, user);

      const row = await tx.deck.create({
        data: {
          userId: user.id,
          name: copyName(source.name),
          format: source.format,
          isPublic: false,
          ownedOnly: source.ownedOnly,
          cards: { createMany: { data: source.cards } },
        },
        select: { id: true },
      });

      return this.saveResult(tx, row.id);
    });
  }

  /** Owner only: the result states the owner's available copies, which is private. */
  async validate(user: AuthUser, id: string): Promise<DeckValidation> {
    const deck = await this.prisma.deck.findUnique({
      where: { id },
      select: { userId: true, isPublic: true },
    });
    assertVisible(deck, user);
    assertOwner(deck.userId, user);

    return this.validation.validate(id);
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

function copyName(name: string): string {
  return `${name.slice(0, DECK_NAME_MAX - COPY_SUFFIX.length).trimEnd()}${COPY_SUFFIX}`;
}

function toDetail({ user, ...row }: DetailRow): DeckDetail {
  return DeckDetailSchema.parse({
    ...row,
    ownerDisplayName: user.displayName,
    cards: row.cards.map((entry) => ({
      cardId: entry.cardId,
      count: entry.count,
      card: toCardSummary(entry.card),
    })),
  });
}
