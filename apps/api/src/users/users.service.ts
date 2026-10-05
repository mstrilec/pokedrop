import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MyProfileSchema,
  PublicProfileSchema,
  type MyProfile,
  type PublicProfile,
  type UpdateMyProfile,
  USER_SEARCH_LIMIT,
  UserSearchResultSchema,
  type UserSearchResult,
} from '@pokedrop/shared';
import { CARD_SUMMARY_SELECT, toCardSummary } from '../common/card-summary.js';
import { escapeLike } from '../common/escape-like.js';
import { InventoryService } from '../inventory/index.js';
import { PrismaService } from '../prisma/index.js';

const PROFILE_SELECT = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  currency: true,
  createdAt: true,
  showCollectionValue: true,
  showSetCompletion: true,
  showcaseCardIds: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * Collectors whose display name contains `q`, an exact name first. Never the caller, never a
   * suspended account, and only the public fields — the trade composer's counterparty search.
   */
  async search(viewerId: string, q: string): Promise<UserSearchResult> {
    const where = { id: { not: viewerId }, suspendedAt: null };
    const select = { id: true, displayName: true, avatarUrl: true } as const;
    const [exact, partial] = await Promise.all([
      this.prisma.user.findMany({
        // Prisma reads an insensitive `equals` as ILIKE, so its wildcards need escaping too.
        where: { ...where, displayName: { equals: escapeLike(q), mode: 'insensitive' } },
        select,
        orderBy: { id: 'asc' },
        take: USER_SEARCH_LIMIT,
      }),
      this.prisma.user.findMany({
        where: { ...where, displayName: { contains: escapeLike(q), mode: 'insensitive' } },
        select,
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        take: USER_SEARCH_LIMIT,
      }),
    ]);
    const seen = new Set(exact.map((user) => user.id));
    return UserSearchResultSchema.parse(
      [...exact, ...partial.filter((user) => !seen.has(user.id))].slice(0, USER_SEARCH_LIMIT),
    );
  }

  async me(userId: string): Promise<MyProfile> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: PROFILE_SELECT,
    });
    const { showCollectionValue, showSetCompletion, showcaseCardIds, ...rest } = user;
    return MyProfileSchema.parse({
      ...rest,
      privacy: { showCollectionValue, showSetCompletion },
      showcase: await this.showcase(userId, showcaseCardIds),
    });
  }

  async updateMe(userId: string, body: UpdateMyProfile): Promise<MyProfile> {
    if (body.showcaseCardIds !== undefined && body.showcaseCardIds.length > 0) {
      const owned = await this.prisma.inventoryItem.findMany({
        where: { userId, cardId: { in: body.showcaseCardIds }, quantity: { gt: 0 } },
        select: { cardId: true },
      });
      const have = new Set(owned.map((row) => row.cardId));
      const missing = body.showcaseCardIds.filter((id) => !have.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(`Not in your collection: ${missing.join(', ')}`);
      }
    }

    await this.prisma.user.update({ where: { id: userId }, data: body });
    return this.me(userId);
  }

  async publicProfile(id: string): Promise<PublicProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        createdAt: true,
        showCollectionValue: true,
        showSetCompletion: true,
        showcaseCardIds: true,
      },
    });
    if (user === null) {
      throw new NotFoundException('User not found');
    }

    const wantsSummary = user.showCollectionValue || user.showSetCompletion;
    const [showcase, publicDeckCount, summary] = await Promise.all([
      this.showcase(user.id, user.showcaseCardIds),
      this.prisma.deck.count({ where: { userId: user.id, isPublic: true } }),
      wantsSummary ? this.inventory.summary(user.id) : null,
    ]);

    return PublicProfileSchema.parse({
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      joinedAt: user.createdAt,
      showcase,
      publicDeckCount,
      ...(summary !== null && user.showCollectionValue
        ? {
            collection: {
              collectionValueUsd: summary.collectionValueUsd,
              pricedCards: summary.pricedCards,
            },
          }
        : {}),
      ...(summary !== null && user.showSetCompletion
        ? {
            completion: {
              uniqueCards: summary.uniqueCards,
              setCompletion: summary.setCompletion,
            },
          }
        : {}),
    });
  }

  /** The chosen cards the user still owns, in the chosen order. */
  private async showcase(userId: string, cardIds: string[]) {
    if (cardIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.inventoryItem.findMany({
      where: { userId, cardId: { in: cardIds }, quantity: { gt: 0 } },
      select: { card: { select: CARD_SUMMARY_SELECT } },
    });
    const byId = new Map(rows.map((row) => [row.card.id, toCardSummary(row.card)]));
    return cardIds.flatMap((id) => {
      const card = byId.get(id);
      return card === undefined ? [] : [card];
    });
  }
}
