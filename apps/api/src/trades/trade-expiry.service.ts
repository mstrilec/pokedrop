import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ERROR_CODES } from '@pokedrop/shared';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { NotificationsService } from '../notifications/index.js';
import { PrismaService } from '../prisma/index.js';
import { TradeCloseService } from './trade-close.service.js';
import { TRADE_SELECT, type TradeRow } from './trade-row.js';

const BATCH_SIZE = 200;
const DAY_MS = 86_400_000;

export type ExpiryResult = { expired: number; raced: number; failed: number; unreconciled: number };

@Injectable()
export class TradeExpiryService {
  private readonly logger = new Logger(TradeExpiryService.name);
  private readonly expiryDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly closer: TradeCloseService,
    private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.expiryDays = config.trades.expiryDays;
  }

  /**
   * Each trade in its own transaction, so one that cannot be closed does not
   * hold back the rest. The scan is keyset-paged over the cutoff set, so every
   * trade is attempted at most once per run and a failing one cannot loop.
   */
  async run(now: Date = new Date()): Promise<ExpiryResult> {
    const cutoff = new Date(now.getTime() - this.expiryDays * DAY_MS);
    const result: ExpiryResult = { expired: 0, raced: 0, failed: 0, unreconciled: 0 };
    let after: { createdAt: Date; id: string } | null = null;

    for (;;) {
      const stale = {
        status: 'PENDING',
        createdAt: { lt: cutoff },
      } satisfies Prisma.TradeWhereInput;
      const batch: TradeRow[] = await this.prisma.trade.findMany({
        where:
          after === null
            ? stale
            : {
                AND: [
                  stale,
                  {
                    OR: [
                      { createdAt: { gt: after.createdAt } },
                      { createdAt: after.createdAt, id: { gt: after.id } },
                    ],
                  },
                ],
              },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: BATCH_SIZE,
        select: TRADE_SELECT,
      });

      for (const trade of batch) {
        try {
          await this.prisma.withTransaction((tx) =>
            this.closer.close(tx, trade, {
              to: 'CANCELLED',
              action: 'trade.expire',
              actorId: null,
              release: true,
            }),
          );
        } catch (error) {
          if (isNotPending(error)) {
            result.raced += 1;
          } else {
            result.failed += 1;
            this.logger.error(`Trade ${trade.id} could not be expired: ${describe(error)}`);
          }
          continue;
        }

        result.expired += 1;
        await this.notifications.notify(
          [trade.initiatorId, trade.recipientId].map((userId) => ({
            userId,
            type: 'trade.expired',
            payload: { tradeId: trade.id },
          })),
        );
      }

      const last = batch.at(-1);
      if (batch.length < BATCH_SIZE || last === undefined) {
        break;
      }
      after = { createdAt: last.createdAt, id: last.id };
    }

    result.unreconciled = await this.unreconciledLocks();
    if (result.unreconciled > 0) {
      this.logger.error(
        `${result.unreconciled} inventory rows hold a lock no pending trade accounts for`,
      );
    }
    this.logger.log(
      `Expired ${result.expired} trades older than ${this.expiryDays} days (${result.raced} closed first by someone else, ${result.failed} failed)`,
    );
    return result;
  }

  /** The lock invariant from docs/DataModel.md (Trade); the only way to see a leak that already happened. */
  private async unreconciledLocks(): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ count: number }[]>`
      WITH promised AS (
        SELECT t."initiatorId" AS u, ti."cardId" AS c, SUM(ti.quantity) AS q
        FROM trades t JOIN trade_items ti ON ti."tradeId" = t.id
        WHERE t.status = 'PENDING' AND ti.side = 'OFFERED'
        GROUP BY 1, 2
      )
      SELECT COUNT(*)::int AS count
      FROM inventory_items i
      FULL JOIN promised p ON p.u = i."userId" AND p.c = i."cardId"
      WHERE COALESCE(i."lockedQuantity", 0) <> COALESCE(p.q, 0)`;
    return row?.count ?? 0;
  }
}

function isNotPending(error: unknown): boolean {
  if (!(error instanceof HttpException)) {
    return false;
  }
  const response = error.getResponse();
  return (
    typeof response === 'object' &&
    response !== null &&
    'code' in response &&
    response.code === ERROR_CODES.TRADE_NOT_PENDING
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
