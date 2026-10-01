'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useUi } from '@/lib/stores/ui';
import { cn } from '@/lib/utils';

const WIDE = '(min-width: 64rem)';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

// Wide screens show the sidebar in place; narrow ones slide it in over the
// page. A closed drawer is inert, so keyboard focus never lands on links
// nobody can see.
export function SidebarFrame({ children }: { children: ReactNode }) {
  const navOpen = useUi((s) => s.navOpen);
  const setNavOpen = useUi((s) => s.setNavOpen);
  const wide = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
  const aside = useRef<HTMLElement>(null);

  // Focus goes back to the button that opened the drawer, not to the page body.
  const close = useCallback(() => {
    setNavOpen(false);
    document.querySelector<HTMLElement>('[aria-controls="app-sidebar"]')?.focus();
  }, [setNavOpen]);

  useEffect(() => {
    if (!navOpen || wide) return;
    aside.current?.querySelector<HTMLElement>('a[href]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen, wide, close]);

  return (
    <>
      {navOpen && !wide ? (
        <div
          aria-hidden
          className="fixed inset-0 z-30 bg-scrim backdrop-blur-scrim"
          onClick={close}
        />
      ) : null}
      <aside
        ref={aside}
        id="app-sidebar"
        aria-label="Sidebar"
        inert={!wide && !navOpen}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-59 flex-col border-r border-bd bg-surface transition-transform',
          'lg:sticky lg:top-0 lg:h-dvh lg:shrink-0 lg:translate-x-0 lg:bg-surface/60 lg:backdrop-blur-bar',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {children}
      </aside>
    </>
  );
}
