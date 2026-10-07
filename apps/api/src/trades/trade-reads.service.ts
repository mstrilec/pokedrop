import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, TradeStatus } from '@prisma/client';
import {
  TradeDetailSchema,
  TradePageSchema,
  TradeStatusSchema,
  type AdminTradeQuery,
  type TradeDetail,
  type TradeInboxQuery,
  type TradePage,
  type TradeTab,
  type TradeTimelineEntry,
} from '@pokedrop/shared';
import { CARD_SUMMARY_SELECT, toCardSummary } from '../common/card-summary.js';
import { decodeNewestCursor, encodeNewestCursor } from '../common/newest-cursor.js';
import type { AuthUser } from '../common/request-auth.js';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { PrismaService } from '../prisma/index.js';

const PARTY_SELECT = { id: true, displayName: true, avatarUrl: true } satisfies Prisma.UserSelect;

const VIEW_SELECT = {
  id: true,
  status: true,
  currencyFromInitiator: true,
  currencyFromRecipient: true,
  counteredTradeId: true,
  createdAt: true,
  resolvedAt: true,
  initiator: { select: PARTY_SELECT },
  recipient: { select: PARTY_SELECT },
  items: {
    orderBy: [{ side: 'asc' }, { cardId: 'asc' }],
    select: {
      id: true,
      side: true,
      cardId: true,
      quantity: true,
      card: { select: CARD_SUMMARY_SELECT },
    },
  },
} satisfies Prisma.TradeSelect;

type ViewRow = Prisma.TradeGetPayload<{ select: typeof VIEW_SELECT }>;

type Actor = TradeTimelineEntry['by'];

/** An explicit list rather than `not: PENDING`, so the tab is an index condition on status. */
const CLOSED: TradeStatus[] = ['ACCEPTED', 'DECLINED', 'COUNTERED', 'CANCELLED', 'VOIDED'];

@Injectable()
export class TradeReadsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async inbox(user: AuthUser, query: TradeInboxQuery): Promise<TradePage> {
    const cursor = query.cursor === undefined ? null : decodeNewestCursor(query.cursor);

    // The tab stays its own AND element so no cursor branch can widen it.
    const scope = tabScope(user.id, query.tab);
    const where: Prisma.TradeWhereInput =
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
      this.prisma.trade.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.pageSize + 1,
        select: VIEW_SELECT,
      }),
      this.prisma.trade.count({ where: scope }),
    ]);

    const page = rows.slice(0, query.pageSize);
    const last = page.at(-1);

    return TradePageSchema.parse({
      items: page.map((row) => toView(row, user.id, this.config.trades.expiryDays)),
      pageSize: query.pageSize,
      total,
      nextCursor:
        rows.length > query.pageSize && last !== undefined
          ? encodeNewestCursor(last.createdAt, last.id)
          : null,
    });
  }

  /** Every trade, newest first; `role` is null on every row because the reader is no party. */
  async adminList(query: AdminTradeQuery): Promise<TradePage> {
    const cursor = query.cursor === undefined ? null : decodeNewestCursor(query.cursor);
    const scope = adminScope(query);
    const where: Prisma.TradeWhereInput =
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
      this.prisma.trade.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.pageSize + 1,
        select: VIEW_SELECT,
      }),
      this.prisma.trade.count({ where: scope }),
    ]);

    const page = rows.slice(0, query.pageSize);
    const last = page.at(-1);
    return TradePageSchema.parse({
      items: page.map((row) => toView(row, null, this.config.trades.expiryDays)),
      pageSize: query.pageSize,
      total,
      nextCursor:
        rows.length > query.pageSize && last !== undefined
          ? encodeNewestCursor(last.createdAt, last.id)
          : null,
    });
  }

  async detail(user: AuthUser, id: string): Promise<TradeDetail> {
    const row = await this.prisma.trade.findUnique({ where: { id }, select: VIEW_SELECT });
    if (row === null || (row.initiator.id !== user.id && row.recipient.id !== user.id)) {
      throw new NotFoundException('Trade not found');
    }
    return this.withHistory(row, user.id);
  }

  async detailForAdmin(id: string): Promise<TradeDetail> {
    const row = await this.prisma.trade.findUnique({ where: { id }, select: VIEW_SELECT });
    if (row === null) {
      throw new NotFoundException('Trade not found');
    }
    return this.withHistory(row, null);
  }

  private async withHistory(row: ViewRow, viewerId: string | null): Promise<TradeDetail> {
    const [entries, chain] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { entity: 'Trade', entityId: row.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { action: true, actorId: true, meta: true, createdAt: true },
      }),
      this.chain(row.id),
    ]);

    // Trades that predate the M8 core have no audit rows, and so no timeline.
    const timeline = entries.flatMap((entry) => {
      const status = TradeStatusSchema.safeParse(metaTo(entry.meta));
      return status.success
        ? [
            {
              action: entry.action,
              status: status.data,
              at: entry.createdAt,
              by: actorOf(row, entry.actorId),
            },
          ]
        : [];
    });

    return TradeDetailSchema.parse({
      ...toView(row, viewerId, this.config.trades.expiryDays),
      timeline,
      chain,
    });
  }

  /** Both directions of the counter list: the trades this one replaced and the ones that replaced it. */
  private async chain(id: string) {
    const links = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE earlier AS (
        SELECT id, "counteredTradeId" FROM trades WHERE id = ${id}
        UNION ALL
        SELECT t.id, t."counteredTradeId" FROM trades t JOIN earlier e ON t.id = e."counteredTradeId"
      ), later AS (
        SELECT id FROM trades WHERE id = ${id}
        UNION ALL
        SELECT t.id FROM trades t JOIN later l ON t."counteredTradeId" = l.id
      )
      SELECT id FROM earlier UNION SELECT id FROM later`;

    return this.prisma.trade.findMany({
      where: { id: { in: links.map((link) => link.id) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, status: true, createdAt: true, resolvedAt: true },
    });
  }
}

function tabScope(userId: string, tab: TradeTab): Prisma.TradeWhereInput {
  const mine: Prisma.TradeWhereInput[] = [{ initiatorId: userId }, { recipientId: userId }];
  switch (tab) {
    case 'incoming':
      return { recipientId: userId, status: 'PENDING' };
    case 'sent':
      return { initiatorId: userId, status: 'PENDING' };
    case 'completed':
      return { OR: mine.map((side) => ({ ...side, status: { in: CLOSED } })) };
    case 'all':
      return { OR: mine };
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The filters as one AND element; a user on either side keeps each side its own index. */
function adminScope(query: AdminTradeQuery): Prisma.TradeWhereInput {
  const and: Prisma.TradeWhereInput[] = [];
  if (query.status !== undefined) and.push({ status: query.status });
  if (query.user !== undefined) {
    and.push({ OR: [{ initiatorId: query.user }, { recipientId: query.user }] });
  }
  if (query.from !== undefined || query.to !== undefined) {
    and.push({
      createdAt: {
        ...(query.from !== undefined ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
        ...(query.to !== undefined
          ? { lt: new Date(new Date(`${query.to}T00:00:00Z`).getTime() + DAY_MS) }
          : {}),
      },
    });
  }
  return and.length === 0 ? {} : { AND: and };
}

function toView(row: ViewRow, viewerId: string | null, expiryDays: number) {
  const { initiator, recipient, items, ...trade } = row;
  const role =
    viewerId === initiator.id ? 'initiator' : viewerId === recipient.id ? 'recipient' : null;
  return {
    ...trade,
    initiator,
    recipient,
    role,
    items: items.map((item) => ({ ...item, card: toCardSummary(item.card) })),
    expiresAt:
      trade.status === 'PENDING' ? new Date(trade.createdAt.getTime() + expiryDays * DAY_MS) : null,
  };
}

/** A timeline says which side acted, never an admin's user id. */
function actorOf(row: ViewRow, actorId: string | null): Actor {
  if (actorId === null) {
    return 'system';
  }
  if (actorId === row.initiator.id) {
    return 'initiator';
  }
  if (actorId === row.recipient.id) {
    return 'recipient';
  }
  return 'admin';
}

function metaTo(meta: Prisma.JsonValue): unknown {
  return typeof meta === 'object' && meta !== null && !Array.isArray(meta) ? meta['to'] : undefined;
}
