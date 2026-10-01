'use client';

import { useEffect } from 'react';

const MESSAGE = 'You have unsaved changes. Leave and discard them?';

// The App Router cannot cancel a navigation, so this covers what can be
// caught: closing or reloading the tab, and clicking a link to another page.
// Back and forward are not covered.
export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
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
      if (!window.confirm(MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);
}
