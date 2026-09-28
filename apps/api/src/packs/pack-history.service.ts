import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  PackHistoryPageSchema,
  type PackHistoryPage,
  type PackHistoryQuery,
} from '@pokedrop/shared';
import { PrismaService } from '../prisma/index.js';
import { decodeNewestCursor, encodeNewestCursor } from '../common/newest-cursor.js';
import { CARD_SUMMARY_SELECT, toCardSummary } from '../common/card-summary.js';

@Injectable()
export class PackHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: PackHistoryQuery): Promise<PackHistoryPage> {
    const cursor = query.cursor === undefined ? null : decodeNewestCursor(query.cursor);

    // userId stays its own AND element so no cursor branch can widen it.
    const scope: Prisma.PackOpeningWhereInput = { userId };
    const where: Prisma.PackOpeningWhereInput =
      cursor === null
        ? scope
        : {
            AND: [
              scope,
              {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              },
            ],
          };

    const [rows, total] = await Promise.all([
      this.prisma.packOpening.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.pageSize + 1,
        select: {
          id: true,
          openId: true,
          templateId: true,
          createdAt: true,
          template: { select: { name: true } },
          cards: {
            orderBy: { position: 'asc' },
            select: {
              position: true,
              cardId: true,
              rarity: true,
              card: { select: CARD_SUMMARY_SELECT },
            },
          },
        },
      }),
      this.prisma.packOpening.count({ where: scope }),
    ]);

    const page = rows.slice(0, query.pageSize);
    const last = page.at(-1);

    return PackHistoryPageSchema.parse({
      items: page.map((row) => ({
        openingId: row.id,
        openId: row.openId,
        templateId: row.templateId,
        templateName: row.template.name,
        createdAt: row.createdAt,
        cards: row.cards.map((card) => ({
          position: card.position,
          cardId: card.cardId,
          rarity: card.rarity,
          card: toCardSummary(card.card),
        })),
      })),
      pageSize: query.pageSize,
      total,
      nextCursor:
        rows.length > query.pageSize && last !== undefined
          ? encodeNewestCursor(last.createdAt, last.id)
          : null,
    });
  }
}
