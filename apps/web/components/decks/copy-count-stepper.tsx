'use client';

import { DECK_MAX_COPIES } from '@pokedrop/shared';
import { Minus, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '@/lib/utils';

type CopyCountStepperProps = {
  count: number;
  /** From `copiesAllowed()`: the limit left after other printings; Infinity for basic energy. */
  max: number;
  onChange: (count: number) => void;
  cardName: string;
  disabled?: boolean;
  className?: string;
};

export function CopyCountStepper({
  count,
  max,
  onChange,
  cardName,
  disabled = false,
  className,
}: CopyCountStepperProps) {
  const reasonId = useId();
  const [refused, setRefused] = useState(false);
  const atMax = count >= max;
  const otherPrintings = Number.isFinite(max) && max < DECK_MAX_COPIES;

  function add() {
    if (atMax) {
      setRefused(true);
      return;
    }
    setRefused(false);
    onChange(count + 1);
  }

  const control =
    'focus-ring flex size-7 cursor-pointer items-center justify-center rounded-tag border border-bd-2 bg-surface-2 text-tx transition hover:bg-elev disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40';

  return (
    <div className={cn('flex flex-col items-end gap-1', className)}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={`Remove a copy of ${cardName}`}
          disabled={disabled || count <= 0}
          onClick={() => {
            setRefused(false);
            onChange(count - 1);
          }}
          className={control}
        >
          <Minus aria-hidden className="size-3.5" />
        </button>
        <span aria-hidden className="min-w-6 text-center font-mono text-mono">
          {count}
        </span>
        <span aria-live="polite" className="sr-only">
          {`${count} ${count === 1 ? 'copy' : 'copies'} of ${cardName}`}
        </span>
        <button
          type="button"
          aria-label={`Add a copy of ${cardName}`}
          // Stays focusable at the limit, so pressing it can say why it refuses.
          aria-disabled={atMax || undefined}
          aria-describedby={atMax ? reasonId : undefined}
          disabled={disabled}
          onClick={add}
          className={control}
        >
          <Plus aria-hidden className="size-3.5" />
        </button>
      </div>
      {atMax && !disabled ? (
        <p
          id={reasonId}
          role={refused ? 'alert' : undefined}
          className={cn('text-[11px] leading-4', refused ? 'text-gold' : 'text-faint')}
        >
          {otherPrintings
            ? `${DECK_MAX_COPIES}-copy limit, counting other printings`
            : `${DECK_MAX_COPIES}-copy limit`}
        </p>
      ) : null}
    </div>
  );
}
