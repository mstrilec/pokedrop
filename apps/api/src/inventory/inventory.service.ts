import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  InventoryPageSchema,
  InventorySummarySchema,
  type InventoryPage,
  type InventoryQuery,
  type InventorySummary,
} from '@pokedrop/shared';
import { domainError } from '../common/errors/domain-error.js';
import { toNumber } from '../common/decimal.js';
import { PrismaService, type TransactionClient } from '../prisma/index.js';
import { escapeLike } from '../common/escape-like.js';
import { CacheService, cacheKeys } from '../redis/index.js';
import { loadSummary } from './inventory.summary.js';
import {
  availableQuantity,
  normalizeChanges,
  type InventoryMove,
  type QuantityChange,
} from './quantity.js';
import {
  SORTS,
  decodeCursor,
  encodeCursor,
  type InventoryCursor,
  type SortKey,
  type SortSpec,
} from './inventory.cursor.js';

const ENTRY_SELECT = {
  id: true,
  cardId: true,
  quantity: true,
  lockedQuantity: true,
  acquiredAt: true,
  card: {
    select: {
      id: true,
      setId: true,
      name: true,
      supertype: true,
      subtypes: true,
      types: true,
      hp: true,
      rarity: true,
      imageSmall: true,
      latestPriceUsd: true,
      latestPriceEur: true,
      priceUpdatedAt: true,
    },
  },
} satisfies Prisma.InventoryItemSelect;

type EntryRow = Prisma.InventoryItemGetPayload<{ select: typeof ENTRY_SELECT }>;

type KeyFilter = { lt?: string | Date; gt?: string | Date; equals?: string | Date } | null;

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  summary(userId: string): Promise<InventorySummary> {
    return this.cache.getOrSet(
      cacheKeys.inventorySummary(userId),
      this.cache.ttl.inventorySummary,
      () => loadSummary(this.prisma, userId),
      InventorySummarySchema,
    );
  }

  async invalidateSummary(userId: string): Promise<void> {
    await this.cache.del(cacheKeys.inventorySummary(userId));
  }

  async list(userId: string, query: InventoryQuery): Promise<InventoryPage> {
    const spec = SORTS[query.sort];
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor, query.sort);

    // userId stays its own AND element so no filter or cursor branch can widen it.
    const scope: Prisma.InventoryItemWhereInput[] = [{ userId }, ...filterClauses(query)];
    const page: Prisma.InventoryItemWhereInput[] =
      cursor === null ? scope : [...scope, afterCursor(spec, cursor)];

    const [rows, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: { AND: page },
        orderBy: orderBy(spec),
        take: query.pageSize + 1,
        select: ENTRY_SELECT,
      }),
      this.prisma.inventoryItem.count({ where: { AND: scope } }),
    ]);

    const items = rows.slice(0, query.pageSize);
    const last = items.at(-1);
    const nextCursor =
      rows.length > query.pageSize && last !== undefined
        ? encodeCursor(query.sort, sortValue(spec.key, last), last.id)
        : null;

    return InventoryPageSchema.parse({
      items: items.map(toEntry),
      pageSize: query.pageSize,
      total,
      nextCursor,
    });
  }

  // A conditional UPDATE rather than leaning on the CHECK constraint: a CHECK
  // violation aborts the caller's whole transaction and surfaces as a 500, where
  // this leaves it usable and answers 409.
  async lock(tx: TransactionClient, userId: string, changes: QuantityChange[]): Promise<void> {
    for (const change of normalizeChanges(changes)) {
      const updated = await tx.$executeRaw`
        UPDATE inventory_items
        SET "lockedQuantity" = "lockedQuantity" + ${change.quantity}
        WHERE "userId" = ${userId}
          AND "cardId" = ${change.cardId}
          AND quantity - "lockedQuantity" >= ${change.quantity}`;

      if (updated === 0) {
        throw domainError(
          HttpStatus.CONFLICT,
          ERROR_CODES.CARDS_UNAVAILABLE,
          `Not enough available copies of ${change.cardId}`,
        );
      }
    }
  }

  async release(tx: TransactionClient, userId: string, changes: QuantityChange[]): Promise<void> {
    for (const change of normalizeChanges(changes)) {
      const updated = await tx.$executeRaw`
        UPDATE inventory_items
        SET "lockedQuantity" = "lockedQuantity" - ${change.quantity}
        WHERE "userId" = ${userId}
          AND "cardId" = ${change.cardId}
          AND "lockedQuantity" >= ${change.quantity}`;

      if (updated === 0) {
        throw new Error(
          `Escrow invariant broken: cannot release ${change.quantity} of ${change.cardId} for ${userId}`,
        );
      }
    }
  }

  /**
   * Settles card moves inside the caller's transaction. Rows are taken in
   * (userId, cardId) order, the order every other writer uses, so two
   * settlements - or a settlement and a pack open - cannot deadlock. Emptied
   * rows are deleted. The summary is the caller's to invalidate after commit.
   */
  async applyMoves(tx: TransactionClient, moves: InventoryMove[]): Promise<void> {
    const seen = new Set<string>();
    for (const move of moves) {
      if (!Number.isInteger(move.quantity) || move.quantity === 0) {
        throw new Error(`Inventory move for ${move.cardId} must be a non-zero integer`);
      }
      const key = `${move.userId}\u0000${move.cardId}`;
      if (seen.has(key)) {
        throw new Error(`Card ${move.cardId} moves twice for ${move.userId}`);
      }
      seen.add(key);
    }

    const sorted = [...moves].sort(
      (a, b) => compare(a.userId, b.userId) || compare(a.cardId, b.cardId),
    );
    const givers: Prisma.Sql[] = [];

    for (const move of sorted) {
      if (move.quantity > 0) {
        await tx.$executeRaw`
          INSERT INTO inventory_items (id, "userId", "cardId", quantity, "lockedQuantity", "acquiredAt")
          VALUES (${randomUUID()}, ${move.userId}, ${move.cardId}, ${move.quantity}, 0, now())
          ON CONFLICT ("userId", "cardId") DO UPDATE
          SET quantity = inventory_items.quantity + EXCLUDED.quantity,
              "acquiredAt" = EXCLUDED."acquiredAt"`;
        continue;
      }

      const count = -move.quantity;
      const updated = move.fromLock
        ? await tx.$executeRaw`
            UPDATE inventory_items
            SET quantity = quantity - ${count}, "lockedQuantity" = "lockedQuantity" - ${count}
            WHERE "userId" = ${move.userId} AND "cardId" = ${move.cardId}
              AND "lockedQuantity" >= ${count}`
        : await tx.$executeRaw`
            UPDATE inventory_items
            SET quantity = quantity - ${count}
            WHERE "userId" = ${move.userId} AND "cardId" = ${move.cardId}
              AND quantity - "lockedQuantity" >= ${count}`;

      if (updated === 0) {
        if (move.fromLock) {
          this.logger.error(
            `Escrow invariant broken: ${move.userId} has fewer than ${count} locked ${move.cardId}`,
          );
        }
        throw domainError(
          HttpStatus.CONFLICT,
          ERROR_CODES.CARDS_UNAVAILABLE,
          `User ${move.userId} no longer has ${count} available ${move.cardId}`,
        );
      }
      givers.push(Prisma.sql`(${move.userId}, ${move.cardId})`);
    }

    if (givers.length > 0) {
      await tx.$executeRaw`
        DELETE FROM inventory_items
        WHERE quantity = 0 AND "lockedQuantity" = 0
          AND ("userId", "cardId") IN (${Prisma.join(givers)})`;
    }
  }

  async availableQuantities(
    userId: string,
    cardIds: string[],
    client: TransactionClient = this.prisma,
  ): Promise<Map<string, number>> {
    const rows = await client.inventoryItem.findMany({
      where: { userId, cardId: { in: cardIds } },
      select: { cardId: true, quantity: true, lockedQuantity: true },
    });

    return new Map(rows.map((row) => [row.cardId, availableQuantity(row)]));
  }
}

function filterClauses(query: InventoryQuery): Prisma.InventoryItemWhereInput[] {
  const card: Prisma.CardWhereInput = {
    ...(query.set === undefined ? {} : { setId: query.set }),
    ...(query.rarity === undefined ? {} : { rarity: query.rarity }),
    ...(query.type === undefined ? {} : { types: { has: query.type } }),
    ...(query.q === undefined
      ? {}
      : { name: { contains: escapeLike(query.q), mode: 'insensitive' } }),
  };

  const clauses: Prisma.InventoryItemWhereInput[] = [];
  if (Object.keys(card).length > 0) {
    clauses.push({ card: { is: card } });
  }
  if (query.minQuantity !== undefined) {
    clauses.push({ quantity: { gte: query.minQuantity } });
  }
  return clauses;
}

function orderBy(spec: SortSpec): Prisma.InventoryItemOrderByWithRelationInput[] {
  switch (spec.key) {
    case 'acquiredAt':
      return [{ acquiredAt: spec.dir }, { id: spec.dir }];
    case 'name':
      return [{ card: { name: spec.dir } }, { id: spec.dir }];
    case 'price':
      return [{ card: { latestPriceUsd: { sort: spec.dir, nulls: 'last' } } }, { id: spec.dir }];
  }
}

function onKey(key: SortKey, filter: KeyFilter): Prisma.InventoryItemWhereInput {
  switch (key) {
    case 'acquiredAt':
      return { acquiredAt: filter as Prisma.DateTimeFilter };
    case 'name':
      return { card: { is: { name: filter as Prisma.StringFilter } } };
    case 'price':
      return { card: { is: { latestPriceUsd: filter as Prisma.DecimalNullableFilter | null } } };
  }
}

// Unpriced rows sort last in both directions, so the NULL tail follows every
// priced value whichever way "beyond" points.
function afterCursor(spec: SortSpec, cursor: InventoryCursor): Prisma.InventoryItemWhereInput {
  const beyond = <T>(value: T) => (spec.dir === 'asc' ? { gt: value } : { lt: value });
  const idBeyond: Prisma.InventoryItemWhereInput = { id: beyond(cursor.id) };

  if (cursor.v === null) {
    return { AND: [onKey(spec.key, null), idBeyond] };
  }

  const value = spec.key === 'acquiredAt' ? new Date(cursor.v) : cursor.v;
  const branches: Prisma.InventoryItemWhereInput[] = [
    onKey(spec.key, beyond(value)),
    { AND: [onKey(spec.key, { equals: value }), idBeyond] },
  ];
  if (spec.key === 'price') {
    branches.push(onKey('price', null));
  }
  return { OR: branches };
}

function sortValue(key: SortKey, row: EntryRow): string | null {
  switch (key) {
    case 'acquiredAt':
      return row.acquiredAt.toISOString();
    case 'name':
      return row.card.name;
    case 'price':
      return row.card.latestPriceUsd === null ? null : row.card.latestPriceUsd.toFixed(2);
  }
}

function toEntry(row: EntryRow): unknown {
  return {
    id: row.id,
    cardId: row.cardId,
    quantity: row.quantity,
    lockedQuantity: row.lockedQuantity,
    availableQuantity: availableQuantity(row),
    acquiredAt: row.acquiredAt,
    card: {
      ...row.card,
      latestPriceUsd: toNumber(row.card.latestPriceUsd),
      latestPriceEur: toNumber(row.card.latestPriceEur),
    },
  };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
