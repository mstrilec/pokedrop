import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import { me } from '@/lib/api/endpoints/users';
import { keys } from './keys';

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api.call(me()) });
}
