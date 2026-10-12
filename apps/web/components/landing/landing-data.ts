import 'server-only';
import type { Card, CardSet } from '@pokedrop/shared';
import { searchCards, sets } from '@/lib/api/endpoints/catalog';
import { inventorySummary } from '@/lib/api/endpoints/inventory';
import { serverApi } from '@/lib/api/server';

const CHASE_SIZE = 12;
const CHASE_MIN = 6;

export type Completion = { owned: number; total: number };

export type LandingData = {
  cardCount: number | null;
  /** Empty when the API cannot answer. */
  sets: CardSet[];
  /** Priced cards, most valuable first; empty when fewer than six can be shown. */
  chase: Card[];
  /** By set id; null signed out or when the summary cannot be read. */
  completion: Map<string, Completion> | null;
};

// The page must render with the API down: each read fails on its own and only
// removes what it feeds.
export async function landingData(signedIn: boolean): Promise<LandingData> {
  const [count, setList, chase, summary] = await Promise.allSettled([
    serverApi.call(searchCards({ pageSize: 1 })),
    serverApi.call(sets()),
    serverApi.call(searchCards({ sort: 'price_desc', pageSize: CHASE_SIZE })),
    signedIn ? serverApi.call(inventorySummary()) : Promise.resolve(null),
  ]);
  const priced =
    chase.status === 'fulfilled'
      ? chase.value.items.filter((card) => card.latestPriceUsd !== null)
      : [];
  return {
    cardCount: count.status === 'fulfilled' ? count.value.total : null,
    sets: setList.status === 'fulfilled' ? setList.value : [],
    chase: priced.length >= CHASE_MIN ? priced : [],
    completion:
      summary.status === 'fulfilled' && summary.value
        ? new Map(
            summary.value.setCompletion.map((set) => [
              set.setId,
              { owned: set.owned, total: set.total },
            ]),
          )
        : null,
  };
}
