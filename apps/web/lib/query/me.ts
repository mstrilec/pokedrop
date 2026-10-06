import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import { me, progress } from '@/lib/api/endpoints/users';
import { keys } from './keys';

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api.call(me()) });
}

/** The dashboard's checklist, as the API derives it. */
export function useProgress() {
  return useQuery({ queryKey: keys.progress, queryFn: () => api.call(progress()) });
}
