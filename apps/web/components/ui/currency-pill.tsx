'use client';

import { Coins } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { formatCoins } from '@/lib/format';
import { cn } from '@/lib/utils';

type CurrencyPillProps = {
  /** `null` while the balance is unknown. */
  amount: number | null;
  size?: 'sm' | 'md';
  /** A link to the wallet, or a plain figure. */
  interactive?: boolean;
  /** Count from the old balance to the new one and flash the difference. */
  animate?: boolean;
  className?: string;
};

const full = new Intl.NumberFormat('en-US');
const COUNT_MS = 600;
const DELTA_MS = 1800;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// The CSS reduced-motion rule cannot reach a count driven by requestAnimationFrame.
function useCountTo(target: number | null, enabled: boolean): number | null {
  const [shown, setShown] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    const start = from.current;
    from.current = target;
    if (
      target === null ||
      start === null ||
      start === target ||
      !enabled ||
      prefersReducedMotion()
    ) {
      setShown(target);
      return;
    }
    const began = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - began) / COUNT_MS);
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(start + (target - start) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, enabled]);

  return shown;
}

function useDelta(amount: number | null, enabled: boolean) {
  const [delta, setDelta] = useState<{ value: number; key: number } | null>(null);
  const last = useRef(amount);

  useEffect(() => {
    const previous = last.current;
    last.current = amount;
    if (!enabled || amount === null || previous === null || previous === amount) return;
    setDelta({ value: amount - previous, key: Date.now() });
    const timer = setTimeout(() => setDelta(null), DELTA_MS);
    return () => clearTimeout(timer);
  }, [amount, enabled]);

  return delta;
}

export function CurrencyPill({
  amount,
  size = 'md',
  interactive = true,
  animate = true,
  className,
}: CurrencyPillProps) {
  const shown = useCountTo(amount, animate);
  const delta = useDelta(amount, animate);
  const spoken = amount === null ? 'Balance unavailable' : `${full.format(amount)} coins`;

  const body = (
    <>
      <Coins aria-hidden className={size === 'sm' ? 'size-3.5' : 'size-4'} />
      <span
        aria-hidden
        className={cn('font-mono font-semibold', size === 'sm' ? 'text-small' : 'text-mono')}
      >
        {shown === null ? '—' : formatCoins(shown)}
      </span>
      {delta ? (
        <span
          key={delta.key}
          aria-hidden
          className={cn(
            'absolute -top-2.5 right-1 rounded-pill px-1.5 font-mono text-[10px] leading-4 font-semibold animate-in fade-in slide-in-from-bottom-1',
            delta.value > 0 ? 'bg-grn text-on-grn' : 'bg-red text-on-red',
          )}
        >
          {delta.value > 0 ? '+' : '−'}
          {formatCoins(Math.abs(delta.value))}
        </span>
      ) : null}
    </>
  );

  const classes = cn(
    'relative inline-flex shrink-0 items-center rounded-control border border-gold/30 bg-gold-dim text-gold',
    size === 'sm' ? 'h-7 gap-1.5 px-2.5' : 'h-10 gap-2 px-3',
    className,
  );

  return interactive ? (
    <Link
      href="/wallet"
      aria-label={
        amount === null ? 'Balance unavailable. Open wallet' : `Balance ${spoken}. Open wallet`
      }
      className={cn(classes, 'focus-ring transition hover:border-gold/60')}
    >
      {body}
    </Link>
  ) : (
    <span role="img" aria-label={spoken} className={classes}>
      {body}
    </span>
  );
}
