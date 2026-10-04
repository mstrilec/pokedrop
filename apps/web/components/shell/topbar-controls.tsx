'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Coins, LogOut, Menu } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/icon-button';
import { api } from '@/lib/api/browser';
import { unreadCount } from '@/lib/api/endpoints/notifications';
import { keys } from '@/lib/query/keys';
import { useMe } from '@/lib/query/me';
import { useSession } from '@/lib/session/context';
import { useUi } from '@/lib/stores/ui';

const UNREAD_POLL_MS = 60_000;
const coins = new Intl.NumberFormat('en-US');

export function MenuButton() {
  const navOpen = useUi((s) => s.navOpen);
  const setNavOpen = useUi((s) => s.setNavOpen);
  return (
    <IconButton
      icon={Menu}
      label="Open navigation"
      aria-controls="app-sidebar"
      aria-expanded={navOpen}
      onClick={() => setNavOpen(!navOpen)}
      className="lg:hidden"
    />
  );
}

export function CurrencyPill() {
  const { data } = useMe();
  const balance = data ? coins.format(data.currency) : '—';
  return (
    <Link
      href="/wallet"
      aria-label={`Balance ${balance} coins. Open wallet`}
      className="focus-ring flex items-center gap-2 rounded-control border border-gold/30 bg-gold-dim px-3 py-2 text-gold"
    >
      <Coins aria-hidden className="size-4" />
      <span className="font-mono text-mono">{balance}</span>
    </Link>
  );
}

export function NotificationBell() {
  const { data } = useQuery({
    queryKey: keys.notifications.unreadCount,
    queryFn: () => api.call(unreadCount()),
    refetchInterval: UNREAD_POLL_MS,
  });
  return (
    <IconButton asChild icon={Bell} label="Notifications" badge={data?.count ?? 0}>
      <Link href="/notifications" />
    </IconButton>
  );
}

export function AvatarMenu() {
  const identity = useSession();
  const queryClient = useQueryClient();
  if (!identity) return null;

  async function signOut(everywhere: boolean) {
    const response = await fetch(everywhere ? '/api/auth/revoke-sessions' : '/api/auth/sign-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => null);
    if (!response?.ok) {
      toast.error('Couldn’t sign out. Try again.');
      return;
    }
    queryClient.clear();
    // A full load on purpose: nothing of the signed-out user may survive in the
    // router cache or the client stores.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${identity.displayName}`}
        className="focus-ring cursor-pointer rounded-control"
      >
        <Avatar name={identity.displayName} src={identity.avatarUrl} size={40} decorative />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate text-tx">{identity.displayName}</span>
          <span className="text-small text-faint">
            {identity.role === 'ADMIN' ? 'Admin' : 'Member'}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/profile/${identity.id}`}>My profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">Account settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/wallet">Currency & history</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut(false)}>
          <LogOut aria-hidden className="size-4" />
          Sign out
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => void signOut(true)}>
          Sign out of all devices
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
