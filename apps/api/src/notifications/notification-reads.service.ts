import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  NOTIFICATION_PAYLOAD_SCHEMAS,
  NotificationPageSchema,
  TRADE_NOTIFICATION_TYPES,
  type MarkAllRead,
  type NotificationListQuery,
  type NotificationPage,
  type UnreadCount,
} from '@pokedrop/shared';
import { decodeNewestCursor, encodeNewestCursor } from '../common/newest-cursor.js';
import type { AuthUser } from '../common/request-auth.js';
import { PrismaService } from '../prisma/index.js';

const PARTY_SELECT = { id: true, displayName: true, avatarUrl: true } satisfies Prisma.UserSelect;

type Party = Prisma.UserGetPayload<{ select: typeof PARTY_SELECT }>;

const TRADE_KINDS: ReadonlySet<string> = new Set(TRADE_NOTIFICATION_TYPES);

@Injectable()
export class NotificationReadsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, query: NotificationListQuery): Promise<NotificationPage> {
    const cursor = query.cursor === undefined ? null : decodeNewestCursor(query.cursor);

    const scope: Prisma.NotificationWhereInput = query.unread
      ? { userId: user.id, readAt: null }
      : { userId: user.id };
    const where: Prisma.NotificationWhereInput =
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
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.pageSize + 1,
        select: { id: true, type: true, payload: true, readAt: true, createdAt: true },
      }),
      this.prisma.notification.count({ where: scope }),
    ]);

    const page = rows.slice(0, query.pageSize).map((row) => ({
      ...row,
      payload: payloadOf(row.type, row.payload),
    }));
    const parties = await this.counterparties(user.id, page);
    const last = page.at(-1);

    return NotificationPageSchema.parse({
      items: page.map((row) => ({
        ...row,
        counterparty: TRADE_KINDS.has(row.type)
          ? (parties.get(String(row.payload['tradeId'])) ?? null)
          : null,
      })),
      pageSize: query.pageSize,
      total,
      nextCursor:
        rows.length > query.pageSize && last !== undefined
          ? encodeNewestCursor(last.createdAt, last.id)
          : null,
    });
  }

  async unreadCount(user: AuthUser): Promise<UnreadCount> {
    const count = await this.prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });
    return { count };
  }

  /** Idempotent: reading an already-read notification keeps its first `readAt`. */
  async markRead(user: AuthUser, id: string): Promise<void> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (count > 0) {
      return;
    }
    const mine = await this.prisma.notification.count({ where: { id, userId: user.id } });
    if (mine === 0) {
      throw new NotFoundException('Notification not found');
    }
  }

  async markAllRead(user: AuthUser): Promise<MarkAllRead> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  /** One query for the page. Only trades the reader is a party to, so a payload cannot name a stranger's. */
  private async counterparties(
    userId: string,
    rows: { type: string; payload: Record<string, unknown> }[],
  ): Promise<Map<string, Party>> {
    const ids = [
      ...new Set(
        rows.flatMap((row) =>
          TRADE_KINDS.has(row.type) && typeof row.payload['tradeId'] === 'string'
            ? [row.payload['tradeId']]
            : [],
        ),
      ),
    ];
    if (ids.length === 0) {
      return new Map();
    }

    const trades = await this.prisma.trade.findMany({
      where: { id: { in: ids }, OR: [{ initiatorId: userId }, { recipientId: userId }] },
      select: {
        id: true,
        initiator: { select: PARTY_SELECT },
        recipient: { select: PARTY_SELECT },
      },
    });
    return new Map(
      trades.map((trade) => [
        trade.id,
        trade.initiator.id === userId ? trade.recipient : trade.initiator,
      ]),
    );
  }
}

/** A stored key the kind's schema does not name is dropped; an unknown kind shows nothing. */
function payloadOf(type: string, stored: Prisma.JsonValue): Record<string, unknown> {
  const schema = NOTIFICATION_PAYLOAD_SCHEMAS[type as keyof typeof NOTIFICATION_PAYLOAD_SCHEMAS];
  if (schema === undefined) {
    return {};
  }
  const parsed = schema.safeParse(stored);
  return parsed.success ? parsed.data : {};
}
