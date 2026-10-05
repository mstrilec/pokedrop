import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import { publicProfile, userSearch } from '@/lib/api/endpoints/users';
import { keys } from './keys';

export function useUserSearch(q: string) {
  return useQuery({
    queryKey: keys.profiles.search(q),
    queryFn: () => api.call(userSearch(q)),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
  });
}

export function useProfile(id: string | undefined) {
  return useQuery({
    queryKey: keys.profiles.detail(id ?? ''),
    queryFn: () => api.call(publicProfile(id ?? '')),
    enabled: id !== undefined,
    retry: false,
  });
}
