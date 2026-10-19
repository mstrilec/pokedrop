import { type RefObject, useSyncExternalStore } from 'react';

function subscribeToLayout(notify: () => void) {
  const observer = new ResizeObserver(notify);
  observer.observe(document.body);
  window.addEventListener('resize', notify);
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', notify);
  };
}

export function useDocumentTop(ref: RefObject<HTMLElement | null>): number {
  return useSyncExternalStore(
    subscribeToLayout,
    () => {
      const element = ref.current;
      return element ? Math.round(element.getBoundingClientRect().top + window.scrollY) : 0;
    },
    () => 0,
  );
}

export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  return useSyncExternalStore(
    subscribeToLayout,
    () => ref.current?.clientWidth ?? 0,
    () => 0,
  );
}

export function useOffsetWithin(ref: RefObject<HTMLElement | null>, scroller: HTMLElement): number {
  return useSyncExternalStore(
    subscribeToLayout,
    () => {
      const element = ref.current;
      if (!element) return 0;
      const top = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      return Math.round(top + scroller.scrollTop);
    },
    () => 0,
  );
}
