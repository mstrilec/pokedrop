import { keepPreviousData, useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import {
  inventory,
  type InventoryParams,
  inventorySummary,
  ownedCounts,
} from '@/lib/api/endpoints/inventory';
import { keys } from './keys';

export type InventoryFilters = Omit<InventoryParams, 'cursor' | 'pageSize'>;

const PAGE_SIZE = 100;

// Each page says which filters it answers: while a new filter loads, the previous
// results stay on screen (keepPreviousData) and the page must know they are stale.
export function useInventory(filters: InventoryFilters) {
  return useInfiniteQuery({
    queryKey: keys.inventory.list(filters),
    queryFn: async ({ pageParam }) => ({
      ...(await api.call(inventory({ ...filters, cursor: pageParam, pageSize: PAGE_SIZE }))),
      answeredFor: filters,
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    // A refetch of an infinite query requests every loaded page again, one after another:
    // fifty for a scrolled-through collection. Focus does not refetch, and a list nobody
    // shows is dropped at once, so coming back starts from the first page.
    refetchOnWindowFocus: false,
    gcTime: 0,
  });
}

export type Owned = { quantity: number; available: number };

/**
 * The caller's copies of the cards on screen: one request per page of ids, keyed under
 * `inventory` so an opened pack or a settled trade refreshes the badges. `known` holds the
 * ids answered so far; a card not in it has no badge yet rather than a wrong one.
 */
export function useOwnedCounts(pages: readonly (readonly string[])[], enabled: boolean) {
  return useQueries({
    queries: pages.map((ids) => ({
      queryKey: keys.inventory.owned(ids),
      queryFn: () => api.call(ownedCounts(ids)),
      enabled: enabled && ids.length > 0,
      refetchOnWindowFocus: false,
    })),
    combine: (results) => {
      const owned = new Map<string, Owned>();
      const known = new Set<string>();
      results.forEach((result, index) => {
        if (!result.data) return;
        pages[index]?.forEach((id) => known.add(id));
        for (const row of result.data) {
          owned.set(row.cardId, { quantity: row.quantity, available: row.availableQuantity });
        }
      });
      return { owned, known };
    },
  });
}

export function useInventorySummary(enabled = true) {
  return useQuery({
    queryKey: keys.inventory.summary,
    queryFn: () => api.call(inventorySummary()),
    enabled,
  });
}
