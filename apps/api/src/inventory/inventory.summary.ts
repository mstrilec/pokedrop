import { InventorySummarySchema, type InventorySummary } from '@pokedrop/shared';
import type { PrismaService } from '../prisma/index.js';

type SetRow = {
  setId: string;
  name: string;
  total: number;
  totalCards: number;
  uniqueCards: number;
  pricedCards: number;
  valueUsd: string;
  owned: number;
};

// The completion filter is not redundant with LEAST: without it 107 sets reach
// "100%" on the wrong cards. See README.md, "Set completion".
export async function loadSummary(
  prisma: PrismaService,
  userId: string,
): Promise<InventorySummary> {
  const rows = await prisma.$queryRaw<SetRow[]>`
    WITH owned AS (
      SELECT c."setId", i.quantity, c."latestPriceUsd",
             substr(c.id, length(c."setId") + 2) AS num
      FROM inventory_items i
      JOIN cards c ON c.id = i."cardId"
      WHERE i."userId" = ${userId} AND i.quantity > 0
    ),
    numbered AS (
      SELECT DISTINCT c."setId"
      FROM cards c
      WHERE c."setId" IN (SELECT "setId" FROM owned)
        AND substr(c.id, length(c."setId") + 2) ~ '^[0-9]+$'
    )
    SELECT s.id AS "setId",
           s.name,
           s."printedTotal" AS total,
           SUM(o.quantity)::int AS "totalCards",
           COUNT(*)::int AS "uniqueCards",
           COUNT(o."latestPriceUsd")::int AS "pricedCards",
           COALESCE(SUM(o."latestPriceUsd" * o.quantity), 0)::text AS "valueUsd",
           LEAST(
             COUNT(*) FILTER (
               WHERE s.id NOT IN (SELECT "setId" FROM numbered)
                  OR CASE WHEN o.num ~ '^[0-9]{1,9}$' THEN o.num::int END
                     BETWEEN 1 AND s."printedTotal"
             ),
             s."printedTotal"
           )::int AS owned
    FROM owned o
    JOIN sets s ON s.id = o."setId"
    GROUP BY s.id
    ORDER BY s."releaseDate" DESC, s.id`;

  // Summed in cents: adding the per-set decimals as floats drifts.
  const valueCents = rows.reduce((sum, row) => sum + Math.round(Number(row.valueUsd) * 100), 0);

  return InventorySummarySchema.parse({
    totalCards: rows.reduce((sum, row) => sum + row.totalCards, 0),
    uniqueCards: rows.reduce((sum, row) => sum + row.uniqueCards, 0),
    collectionValueUsd: valueCents / 100,
    pricedCards: rows.reduce((sum, row) => sum + row.pricedCards, 0),
    setCompletion: rows.map((row) => ({
      setId: row.setId,
      name: row.name,
      owned: row.owned,
      total: row.total,
    })),
  });
}
