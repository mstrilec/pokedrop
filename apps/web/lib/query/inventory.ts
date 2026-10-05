import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import { inventory, type InventoryParams, inventorySummary } from '@/lib/api/endpoints/inventory';
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

export function useInventorySummary() {
  return useQuery({
    queryKey: keys.inventory.summary,
    queryFn: () => api.call(inventorySummary()),
  });
}
