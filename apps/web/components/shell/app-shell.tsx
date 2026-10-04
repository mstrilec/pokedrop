import type { MyProfile } from '@pokedrop/shared';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { PackageOpen, Search } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { keys } from '@/lib/query/keys';
import { getServerQueryClient } from '@/lib/query/server';
import { SessionProvider } from '@/lib/session/context';
import { identityOf } from '@/lib/session/identity';
import { Sidebar } from './sidebar';
import { AvatarMenu, CurrencyPill, MenuButton, NotificationBell } from './topbar-controls';

// The chrome around every signed-in page, including the public pages a
// signed-in visitor opens. The session's profile seeds the `me` query, so the
// balance renders without a request.
export function AppShell({ profile, children }: { profile: MyProfile; children: ReactNode }) {
  const queryClient = getServerQueryClient();
  queryClient.setQueryData(keys.me, profile);

  return (
    <SessionProvider identity={identityOf(profile)}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <a
          href="#content"
          className="focus-ring sr-only z-50 rounded-control bg-pri px-4 py-2 text-on-pri focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <div className="flex min-h-dvh flex-1">
          <Sidebar isAdmin={profile.role === 'ADMIN'} />
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-20 flex h-15 shrink-0 items-center gap-3 border-b border-bd bg-bar px-4 backdrop-blur-bar lg:px-7">
              <MenuButton />
              <search className="hidden max-w-110 flex-1 sm:block">
                <form action="/cards" method="get" className="relative">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
                  />
                  <input
                    type="search"
                    name="q"
                    aria-label="Search cards"
                    placeholder="Search cards…"
                    className="focus-ring w-full rounded-control border border-bd bg-surface py-2 pr-3 pl-10 text-small text-tx placeholder:text-faint"
                  />
                </form>
              </search>
              <div className="flex-1" />
              <CurrencyPill />
              <NotificationBell />
              <Button asChild icon={PackageOpen} className="max-sm:px-3">
                <Link href="/packs" aria-label="Open packs">
                  <span className="hidden sm:inline">Open packs</span>
                </Link>
              </Button>
              <AvatarMenu />
            </header>
            <main id="content" tabIndex={-1} className="flex-1 p-8 outline-none">
              {children}
            </main>
          </div>
        </div>
      </HydrationBoundary>
    </SessionProvider>
  );
}
