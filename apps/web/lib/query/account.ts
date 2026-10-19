import type { UpdateMyProfile } from '@pokedrop/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authApi } from '@/lib/api/browser';
import {
  changePassword,
  currentSession,
  listSessions,
  revokeOtherSessions,
} from '@/lib/api/endpoints/auth';
import { updateMe } from '@/lib/api/endpoints/users';
import { mutationKeys } from './invalidation';
import { keys } from './keys';

export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: mutationKeys.updateMe,
    mutationFn: (body: UpdateMyProfile) => api.call(updateMe(body)),
    onSuccess: (profile) => queryClient.setQueryData(keys.me, profile),
    meta: { toast: false },
  });
}

export function useSessions() {
  return useQuery({
    queryKey: keys.sessions,
    queryFn: async () => {
      const [sessions, current] = await Promise.all([
        authApi.call(listSessions()),
        authApi.call(currentSession()),
      ]);
      return { sessions, currentId: current?.session.id ?? null };
    },
  });
}

export function useRevokeOtherSessions() {
  return useMutation({
    mutationKey: mutationKeys.revokeOtherSessions,
    mutationFn: () => authApi.call(revokeOtherSessions()),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationKey: mutationKeys.changePassword,
    mutationFn: (body: Parameters<typeof changePassword>[0]) => authApi.call(changePassword(body)),
    meta: { toast: false },
  });
}
