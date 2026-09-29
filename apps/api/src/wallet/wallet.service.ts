import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type TransactionType } from '@prisma/client';
import {
  WalletPageSchema,
  type WalletPage,
  type WalletQuery,
  type WalletSourceSchema,
} from '@pokedrop/shared';
import type { z } from 'zod';
import { decodeNewestCursor, encodeNewestCursor } from '../common/newest-cursor.js';
import { WELCOME_GRANT_REF } from '../economy/index.js';
import { PrismaService } from '../prisma/index.js';

type LedgerRow = {
  id: string;
  type: TransactionType;
  amount: number;
  refId: string | null;
  createdAt: Date;
  balanceAfter: number;
  openingId: string | null;
  templateName: string | null;
  tradeId: string | null;
  partyId: string | null;
  partyName: string | null;
  partyAvatar: string | null;
};

const TYPES_OF: Record<NonNullable<WalletQuery['type']>, TransactionType[]> = {
  GRANT: ['GRANT'],
  PACK_SPEND: ['PACK_SPEND'],
  TRADE: ['TRADE', 'TRADE_REVERSAL'],
};

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private readonly prisma: PrismaService) {}

  async page(userId: string, query: WalletQuery): Promise<WalletPage> {
    const cursor = query.cursor === undefined ? null : decodeNewestCursor(query.cursor);
    const types = query.type === undefined ? null : TYPES_OF[query.type];

    const typeFilter =
      types === null ? Prisma.empty : Prisma.sql`AND l.type = ANY(${types}::"TransactionType"[])`;
    const cursorFilter =
      cursor === null
        ? Prisma.empty
        : Prisma.sql`AND (l."createdAt" < ${cursor.createdAt}
            OR (l."createdAt" = ${cursor.createdAt} AND l.id < ${cursor.id}))`;

    // The running total is taken over the whole ledger before any filter, so a
    // filtered page still shows the real balance after each row.
    const [rows, total, balance] = await Promise.all([
      this.prisma.$queryRaw<LedgerRow[]>`
        WITH l AS (
          SELECT id, type, amount, "refId", "createdAt",
                 (SUM(amount) OVER (ORDER BY "createdAt", id))::int AS "balanceAfter"
          FROM currency_transactions
          WHERE "userId" = ${userId}
        )
        SELECT l.*,
               po.id AS "openingId", pt.name AS "templateName",
               t.id AS "tradeId", p.id AS "partyId", p."displayName" AS "partyName",
               p."avatarUrl" AS "partyAvatar"
        FROM l
        LEFT JOIN pack_openings po
          ON l.type = 'PACK_SPEND' AND po."openId" = l."refId" AND po."userId" = ${userId}
        LEFT JOIN pack_templates pt ON pt.id = po."templateId"
        LEFT JOIN trades t
          ON l.type IN ('TRADE', 'TRADE_REVERSAL') AND t.id = l."refId"
          AND ${userId} IN (t."initiatorId", t."recipientId")
        LEFT JOIN users p
          ON p.id = CASE WHEN t."initiatorId" = ${userId} THEN t."recipientId" ELSE t."initiatorId" END
        WHERE TRUE ${typeFilter} ${cursorFilter}
        ORDER BY l."createdAt" DESC, l.id DESC
        LIMIT ${query.pageSize + 1}`,
      this.prisma.currencyTransaction.count({
        where: { userId, ...(types === null ? {} : { type: { in: types } }) },
      }),
      this.balance(userId),
    ]);

    const page = rows.slice(0, query.pageSize);
    const last = page.at(-1);

    return WalletPageSchema.parse({
      balance,
      items: page.map((row) => ({
        id: row.id,
        type: row.type,
        amount: row.amount,
        balanceAfter: row.balanceAfter,
        source: sourceOf(row),
        createdAt: row.createdAt,
      })),
      pageSize: query.pageSize,
      total,
      nextCursor:
        rows.length > query.pageSize && last !== undefined
          ? encodeNewestCursor(last.createdAt, last.id)
          : null,
    });
  }

  /**
   * The stored balance, checked against the ledger in the same statement so a
   * write landing between two reads can never look like a mismatch. A mismatch
   * is logged, not repaired and not shown: the stored balance is what every
   * debit is guarded against, so it is the one the member sees.
   */
  private async balance(userId: string): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ currency: number; ledger: number }[]>`
      SELECT u.currency,
             COALESCE((SELECT SUM(amount) FROM currency_transactions WHERE "userId" = u.id), 0)::int
               AS ledger
      FROM users u WHERE u.id = ${userId}`;
    if (row === undefined) {
      return 0;
    }
    if (row.currency !== row.ledger) {
      this.logger.error(
        `Ledger mismatch for ${userId}: balance ${row.currency}, ledger ${row.ledger}`,
      );
    }
    return row.currency;
  }
}

function sourceOf(row: LedgerRow): z.input<typeof WalletSourceSchema> | null {
  switch (row.type) {
    case 'GRANT':
      return row.refId === WELCOME_GRANT_REF ? { kind: 'welcome' } : { kind: 'grant' };
    case 'PACK_SPEND':
      return row.openingId === null || row.templateName === null
        ? null
        : { kind: 'pack', openingId: row.openingId, templateName: row.templateName };
    case 'TRADE':
    case 'TRADE_REVERSAL':
      return row.tradeId === null || row.partyId === null || row.partyName === null
        ? null
        : {
            kind: 'trade',
            tradeId: row.tradeId,
            counterparty: {
              id: row.partyId,
              displayName: row.partyName,
              avatarUrl: row.partyAvatar,
            },
          };
  }
}
