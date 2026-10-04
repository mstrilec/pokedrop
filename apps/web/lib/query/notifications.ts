import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import {
  markAllNotificationsRead,
  markNotificationRead,
  notifications,
  unreadCount,
} from '@/lib/api/endpoints/notifications';
import { mutationKeys } from './invalidation';
import { keys } from './keys';

const UNREAD_POLL_MS = 60_000;

export function useUnreadCount() {
  return useQuery({
    queryKey: keys.notifications.unreadCount,
    queryFn: () => api.call(unreadCount()),
    refetchInterval: UNREAD_POLL_MS,
  });
}

export function useNotifications(unread: boolean) {
  return useInfiniteQuery({
    queryKey: keys.notifications.list({ unread }),
    queryFn: ({ pageParam }) =>
      api.call(notifications({ unread: unread ? 'true' : 'false', cursor: pageParam })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useMarkNotificationRead() {
  return useMutation({
    mutationKey: mutationKeys.markNotificationRead,
    mutationFn: (id: string) => api.call(markNotificationRead(id)),
  });
}

export function useMarkAllNotificationsRead() {
  return useMutation({
    mutationKey: mutationKeys.markAllNotificationsRead,
    mutationFn: () => api.call(markAllNotificationsRead()),
  });
}
