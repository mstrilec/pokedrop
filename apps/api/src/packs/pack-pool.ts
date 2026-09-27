import type { SetFilter } from '@pokedrop/shared';
import type { TransactionClient } from '../prisma/index.js';
import type { CardPool } from './pack-generator.js';

// The id order inside each bucket is part of what a stored seed reproduces:
// the generator indexes into it. Sorted here by code unit rather than by the
// database, whose ORDER BY follows its collation and could differ elsewhere.
export async function loadPool(client: TransactionClient, setFilter: SetFilter): Promise<CardPool> {
  const rows = await client.card.findMany({
    where: { setId: { in: setFilter.setIds }, rarity: { not: null } },
    select: { id: true, rarity: true },
  });

  const pool = new Map<string, string[]>();
  for (const row of rows) {
    if (row.rarity === null) {
      continue;
    }
    const bucket = pool.get(row.rarity);
    if (bucket === undefined) {
      pool.set(row.rarity, [row.id]);
    } else {
      bucket.push(row.id);
    }
  }

  for (const bucket of pool.values()) {
    bucket.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  return pool;
}
