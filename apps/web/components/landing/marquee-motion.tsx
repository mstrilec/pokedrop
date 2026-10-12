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
export function MarqueeMotion({
  items,
  copy,
  label,
}: {
  items: ReactNode[];
  /** The same items rendered out of the tab order, for the seamless second half. */
  copy: ReactNode[];
  label: string;
}) {
  const moving = useSyncExternalStore(
    subscribe,
    () => matchMedia(QUERY).matches,
    () => false,
  );
  const [paused, setPaused] = useState(false);
  // Keyboard focus inside stops the marquee for good and makes the track a scrollable rail in
  // place, so the browser can scroll each focused card into view; swapping the markup would drop
  // focus. A mouse press focuses a link too, but moving the track under it would lose the click.
  const [stopped, setStopped] = useState(false);

  if (!moving) {
    return (
      <ul
        aria-label={label}
        className={cn(
          'flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 pt-4 pb-6 sm:scroll-px-14 sm:px-14',
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
        {stopped ? null : (
          <Button
            size="sm"
            variant="secondary"
            icon={paused ? Play : Pause}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? 'Play' : 'Pause'}
          </Button>
        )}
      </div>
      <div
        onFocus={(event) => {
          if (event.target.matches(':focus-visible')) setStopped(true);
        }}
        className={cn(
          'pt-4 pb-6',
          stopped
            ? 'snap-x snap-mandatory scroll-px-5 overflow-x-auto px-5 sm:scroll-px-14 sm:px-14'
            : 'overflow-hidden',
          MASK,
        )}
      >
        {/* Two identical halves: the track moves by -50% and starts over seamlessly. */}
        <div
          className={cn(
            'flex w-max',
            stopped
              ? ''
              : 'animate-marquee hover:[animation-play-state:paused] focus-within:[animation-play-state:paused]',
            paused && '[animation-play-state:paused]',
          )}
        >
          <ul aria-label={label} className="flex gap-4 pr-4">
            {items}
          </ul>
          <ul aria-hidden className={cn('flex gap-4 pr-4', stopped && 'hidden')}>
            {copy}
          </ul>
        </div>
      </div>
    </>
  );
}
