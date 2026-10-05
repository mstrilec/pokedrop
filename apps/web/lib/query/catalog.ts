import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import { type CardSearchParams, facets, searchCards } from '@/lib/api/endpoints/catalog';
import { keys } from './keys';

// Global counts over the whole mirror; the catalog root's 30-minute stale time applies.
export function useCatalogFacets() {
  return useQuery({ queryKey: keys.catalog.facets, queryFn: () => api.call(facets()) });
}

export type CatalogFilters = Omit<CardSearchParams, 'page' | 'pageSize'>;

const PAGE_SIZE = 100;

// The inventory's pattern: each page says which filters it answers, earlier results stay on
// screen while a new filter loads, and refetching is never "every loaded page again".
export function useCatalogBrowse(filters: CatalogFilters) {
  return useInfiniteQuery({
    queryKey: keys.catalog.browse(filters),
    queryFn: async ({ pageParam }) => ({
      ...(await api.call(searchCards({ ...filters, page: pageParam, pageSize: PAGE_SIZE }))),
      answeredFor: filters,
    }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    gcTime: 0,
  });
}
