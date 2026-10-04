import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import { facets } from '@/lib/api/endpoints/catalog';
import { keys } from './keys';

// Global counts over the whole mirror; the catalog root's 30-minute stale time applies.
export function useCatalogFacets() {
  return useQuery({ queryKey: keys.catalog.facets, queryFn: () => api.call(facets()) });
}
