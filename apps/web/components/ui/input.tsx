'use client';

import { CircleAlert, Eye, EyeOff } from 'lucide-react';
import { type ComponentProps, useId, useState } from 'react';
import { cn } from '@/lib/utils';

export type InputProps = Omit<ComponentProps<'input'>, 'size'> & {
  label: string;
  help?: string;
  error?: string;
  mono?: boolean;
  hideLabel?: boolean;
};

export function Input({
  label,
  help,
  error,
  mono = false,
  hideLabel = false,
  id,
  type = 'text',
  className,
  'aria-describedby': describedBy,
  ...props
}: InputProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const [revealed, setRevealed] = useState(false);
  const password = type === 'password';
  const describedByIds =
    [describedBy, help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className={cn('text-small text-mut', hideLabel && 'sr-only')}>
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type={password && revealed ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds}
          className={cn(
            'focus-ring h-10 w-full rounded-control border border-bd-2 bg-bg px-3 text-body text-tx transition placeholder:text-faint disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-red',
            mono && 'font-mono',
            password && 'pr-11',
          )}
          {...props}
        />
        {password ? (
          <button
            type="button"
            aria-label="Show password"
            aria-pressed={revealed}
            onClick={() => setRevealed((r) => !r)}
            className="focus-ring absolute top-1/2 right-1 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-tag text-mut hover:text-tx"
          >
            {revealed ? (
              <EyeOff aria-hidden className="size-4" />
            ) : (
              <Eye aria-hidden className="size-4" />
            )}
          </button>
        ) : null}
      </div>
      {help ? (
        <p id={helpId} className="text-small text-faint">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="flex items-center gap-1.5 text-small text-red">
          <CircleAlert aria-hidden className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
