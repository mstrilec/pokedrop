import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { InventoryPageSchema, type InventoryPage, type InventoryQuery } from '@pokedrop/shared';
import { toNumber } from '../common/decimal.js';
import { PrismaService } from '../prisma/index.js';
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
  constructor(private readonly prisma: PrismaService) {}

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
}

function filterClauses(query: InventoryQuery): Prisma.InventoryItemWhereInput[] {
  const card: Prisma.CardWhereInput = {
    ...(query.set === undefined ? {} : { setId: query.set }),
    ...(query.rarity === undefined ? {} : { rarity: query.rarity }),
    ...(query.type === undefined ? {} : { types: { has: query.type } }),
    ...(query.q === undefined ? {} : { name: { contains: query.q, mode: 'insensitive' } }),
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
    availableQuantity: row.quantity - row.lockedQuantity,
    acquiredAt: row.acquiredAt,
    card: {
      ...row.card,
      latestPriceUsd: toNumber(row.card.latestPriceUsd),
      latestPriceEur: toNumber(row.card.latestPriceEur),
    },
  };
}
