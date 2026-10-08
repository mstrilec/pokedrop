import { Prisma } from '@prisma/client';
import {
  BASIC_ENERGY_TYPES,
  basicEnergyTypeOf,
  type BasicEnergyType,
  type DeckFormat,
} from '@pokedrop/shared';
import type { PoolCard } from './random-deck.types.js';

type Db = { $queryRaw<T = unknown>(query: Prisma.Sql): Prisma.PrismaPromise<T> };
type Row = Omit<PoolCard, 'available'> & { available: number | null };

/** Every card Legal in the format, or for Owned only the member's available copies of them. */
export async function loadPool(
  db: Db,
  { format, userId }: { format: DeckFormat; userId: string | null },
): Promise<PoolCard[]> {
  const available =
    userId === null
      ? Prisma.sql`NULL::int AS available`
      : Prisma.sql`(i.quantity - i."lockedQuantity") AS available`;
  const join =
    userId === null
      ? Prisma.empty
      : Prisma.sql`JOIN inventory_items i ON i."cardId" = c.id AND i."userId" = ${userId}
          AND i.quantity - i."lockedQuantity" > 0`;
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT c.id, c.name, c.supertype, c.subtypes, c.types, c."evolvesFrom", ${available}
    FROM cards c ${join}
    WHERE c.legalities->>${format} = 'Legal'
      AND NOT ('V-UNION' = ANY(c.subtypes))
      AND (c.supertype <> 'Pokémon' OR cardinality(c.types) > 0)
  `);
  return rows.map((row) => ({ ...row, available: row.available ?? Number.POSITIVE_INFINITY }));
}

export function isBasicEnergy(card: Pick<PoolCard, 'supertype' | 'subtypes'>): boolean {
  return card.supertype === 'Energy' && card.subtypes.includes('Basic');
}

/** The basic Energy types the pool can supply, in BASIC_ENERGY_TYPES order. */
export function generatableTypes(pool: PoolCard[]): BasicEnergyType[] {
  const types = new Set(pool.filter(isBasicEnergy).map((card) => basicEnergyTypeOf(card.name)));
  return BASIC_ENERGY_TYPES.filter((type) => types.has(type));
}
