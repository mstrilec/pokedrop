'use client';

import type { NotificationView } from '@pokedrop/shared';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { ListError, LoadMore } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, useUrlTab } from '@/components/ui/tabs';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from '@/lib/query/notifications';
import { toastSuccess } from '@/lib/toast';
import { NotificationRow } from './notification-row';

const SHOW = ['all', 'unread'] as const;

function Row({ notification }: { notification: NotificationView }) {
  const markRead = useMarkNotificationRead();
  const unread = notification.readAt === null;
  const read = () => {
    if (unread) markRead.mutate(notification.id);
  };
  return (
    <li className="flex items-center gap-2">
      <NotificationRow notification={notification} onActivate={read} className="flex-1" />
      {unread ? (
        <IconButton
          icon={Check}
          label="Mark as read"
          variant="ghost"
          disabled={markRead.isPending}
          onClick={read}
        />
      ) : (
        // Keeps every row the same width, read or not.
        <span aria-hidden className="size-10 shrink-0" />
      )}
    </li>
  );
}

export function NotificationCentre() {
  const [show, setShow] = useUrlTab('show', SHOW);
  const list = useNotifications(show === 'unread');
  const unread = useUnreadCount();
  const markAll = useMarkAllNotificationsRead();
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const unreadCount = unread.data?.count ?? 0;

  const markAllButton = (
    <Button
      variant="secondary"
      icon={CheckCheck}
      disabled={unreadCount === 0}
      loading={markAll.isPending}
      onClick={() =>
        markAll.mutate(undefined, {
          onSuccess: ({ updated }) =>
            toastSuccess(
              updated === 1
                ? 'Marked 1 notification as read'
                : `Marked ${updated} notifications as read`,
            ),
        })
      }
    >
      Mark all as read
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Everything behind the bell, newest first."
        actions={markAllButton}
      />
      <Tabs
        tabs={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: 'Unread', count: unread.data?.count },
        ]}
        value={show}
        onValueChange={setShow}
        label="Show notifications"
      >
        {list.isPending ? (
          <ul aria-busy="true" aria-label="Loading notifications" className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((row) => (
              <li key={row}>
                <Skeleton shape="block" height="4.25rem" />
              </li>
            ))}
          </ul>
        ) : list.isError ? (
          <ListError error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            tone="neutral"
            title={show === 'unread' ? 'You are all caught up' : 'No notifications yet'}
            body={
              show === 'unread'
                ? 'Nothing new since you last looked.'
                : 'Trade offers, replies and coins you receive will show up here.'
            }
            cta={{ label: 'Go to your trades', href: '/trades' }}
          />
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {items.map((notification) => (
                <Row key={notification.id} notification={notification} />
              ))}
            </ul>
            <LoadMore
              shown={items.length}
              total={total}
              noun={total === 1 ? 'notification' : 'notifications'}
              hasMore={list.hasNextPage}
              loading={list.isFetchingNextPage}
              onLoad={() => void list.fetchNextPage()}
            />
          </>
        )}
      </Tabs>
    </>
  );
}
