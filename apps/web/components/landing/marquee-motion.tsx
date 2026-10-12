'use client';

import { Pause, Play } from 'lucide-react';
import { type ReactNode, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const QUERY = '(min-width: 640px) and (prefers-reduced-motion: no-preference)';
const MASK = '[mask-image:linear-gradient(90deg,transparent,#000_6%,#000_94%,transparent)]';

const subscribe = (change: () => void) => {
  const list = matchMedia(QUERY);
  list.addEventListener('change', change);
  return () => list.removeEventListener('change', change);
};

/**
 * A scroll-snap rail that becomes a marquee on wider screens with motion
 * allowed. The server and hydration render the rail.
 */
export function MarqueeMotion({ items, label }: { items: ReactNode[]; label: string }) {
  const moving = useSyncExternalStore(
    subscribe,
    () => matchMedia(QUERY).matches,
    () => false,
  );
  const [paused, setPaused] = useState(false);

  if (!moving) {
    return (
      <ul
        aria-label={label}
        className={cn(
          'flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pt-4 pb-6 sm:px-14',
          MASK,
        )}
      >
        {items}
      </ul>
    );
  }

  return (
    <>
      <div className="mx-auto flex max-w-300 justify-end px-5 sm:px-14">
        <Button
          size="sm"
          variant="secondary"
          icon={paused ? Play : Pause}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? 'Play' : 'Pause'}
        </Button>
      </div>
      <div className={cn('overflow-hidden pt-4 pb-6', MASK)}>
        {/* Two identical halves: the track moves by -50% and starts over seamlessly. */}
        <div
          className={cn(
            'flex w-max animate-marquee hover:[animation-play-state:paused] focus-within:[animation-play-state:paused]',
            paused && '[animation-play-state:paused]',
          )}
        >
          <ul aria-label={label} className="flex gap-4 pr-4">
            {items}
          </ul>
          <ul aria-hidden inert className="flex gap-4 pr-4">
            {items}
          </ul>
        </div>
      </div>
    </>
  );
}
