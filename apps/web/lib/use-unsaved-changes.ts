'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

const GUARD = 'pokedropLeaveGuard';

type Leave = () => void;

function onGuardEntry(): boolean {
  return (window.history.state as Record<string, unknown> | null)?.[GUARD] === true;
}

function pushGuard(): void {
  window.history.pushState(
    { ...(window.history.state as object | null), [GUARD]: true },
    '',
    window.location.href,
  );
}

/**
 * While `dirty`, catches what can be caught of leaving the page — the App Router cannot cancel
 * a navigation: closing or reloading the tab (`beforeunload`), a click on a link to another
 * page, and Back, through a sentinel history entry that `popstate` puts back. `onAttempt`
 * decides; calling the `leave` it is given goes on. The sentinel is removed when the page
 * stops being dirty, so one Back leaves after a save. When Back has nowhere to go — the page
 * opened the tab — leaving goes to `fallback` instead.
 */
export function useUnsavedChanges(
  dirty: boolean,
  onAttempt: (leave: Leave) => void,
  fallback = '/',
): void {
  const router = useRouter();
  const attempt = useRef(onAttempt);
  useEffect(() => {
    attempt.current = onAttempt;
  });

  useEffect(() => {
    if (!dirty) return;
    let leaving = false;
    let fallbackTimer: number | undefined;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!leaving) event.preventDefault();
    };

    const onClick = (event: MouseEvent) => {
      if (leaving || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.download) {
        return;
      }
      const url = new URL(link.href);
      const here = window.location;
      if (url.origin !== here.origin || url.pathname + url.search === here.pathname + here.search) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      attempt.current(() => {
        leaving = true;
        router.push(url.pathname + url.search + url.hash);
      });
    };

    // Only a step back from the sentinel onto the page's own entry is Back. A fragment link (a
    // skip link) adds an entry with no state, and stepping onto the sentinel stays on the page.
    const onPopState = (event: PopStateEvent) => {
      if (leaving || event.state === null || onGuardEntry()) return;
      pushGuard();
      attempt.current(() => {
        leaving = true;
        const here = window.location.href;
        window.history.go(-2);
        // Nothing two entries back: go(-2) does nothing, so leave to the fallback.
        fallbackTimer = window.setTimeout(() => {
          if (window.location.href === here) router.replace(fallback);
        }, 500);
      });
    };

    if (!onGuardEntry()) pushGuard();
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
      window.clearTimeout(fallbackTimer);
      if (!leaving && onGuardEntry()) window.history.back();
    };
  }, [dirty, router, fallback]);
}
