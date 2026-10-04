'use client';

import { CircleAlert, Coins } from 'lucide-react';
import { type KeyboardEvent, useId, useState } from 'react';
import { cn } from '@/lib/utils';

type CurrencyInputProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** The balance cap: nothing above it is ever emitted. */
  max?: number;
  /** 0 by default; an admin grant goes negative to take coins back. */
  min?: number;
  help?: string;
  disabled?: boolean;
  className?: string;
};

const grouped = new Intl.NumberFormat('en-US');

export function CurrencyInput({
  label,
  value,
  onChange,
  max,
  min = 0,
  help,
  disabled = false,
  className,
}: CurrencyInputProps) {
  const id = useId();
  const [editing, setEditing] = useState<string | null>(null);
  const [capped, setCapped] = useState(false);

  function commit(next: number) {
    let clamped = Math.max(min, next);
    const over = max !== undefined && clamped > max;
    if (over) clamped = max;
    setCapped(over);
    onChange(clamped);
    return clamped;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const step = event.shiftKey ? 100 : 10;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = commit(value + (event.key === 'ArrowUp' ? step : -step));
      if (editing !== null) setEditing(String(next));
    }
  }

  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const describedBy = [help ? helpId : null, capped ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-small text-mut">
        {label}
      </label>
      <div className="relative">
        <Coins
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-gold"
        />
        <input
          id={id}
          role="spinbutton"
          inputMode="numeric"
          autoComplete="off"
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={`${grouped.format(value)} coins`}
          aria-invalid={capped || undefined}
          aria-describedby={describedBy || undefined}
          disabled={disabled}
          value={editing ?? grouped.format(value)}
          onFocus={() => setEditing(String(value))}
          onBlur={() => setEditing(null)}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            const raw = event.target.value;
            const negative = min < 0 && raw.trim().startsWith('-');
            const digits = raw.replace(/\D/g, '').slice(0, 9);
            if (digits === '') {
              commit(0);
              setEditing(negative ? '-' : '');
              return;
            }
            setEditing(String(commit(Number(digits) * (negative ? -1 : 1))));
          }}
          className="focus-ring h-10 w-full rounded-control border border-gold/30 bg-bg pr-3 pl-9 font-mono text-mono text-gold transition disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-red"
        />
      </div>
      {help ? (
        <p id={helpId} className="text-small text-faint">
          {help}
        </p>
      ) : null}
      {capped && max !== undefined ? (
        <p id={errorId} role="alert" className="flex items-center gap-1.5 text-small text-red">
          <CircleAlert aria-hidden className="size-3.5 shrink-0" />
          You have {grouped.format(max)} coins; that is the most you can offer.
        </p>
      ) : null}
    </div>
  );
}
