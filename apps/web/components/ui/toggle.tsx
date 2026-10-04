'use client';

import { Switch } from 'radix-ui';
import { useId } from 'react';
import { cn } from '@/lib/utils';

export type ToggleProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  onBlur?: () => void;
  className?: string;
};

export function Toggle({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  id,
  name,
  onBlur,
  className,
}: ToggleProps) {
  const generated = useId();
  const switchId = id ?? generated;
  const descriptionId = description ? `${switchId}-description` : undefined;

  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={switchId} className="cursor-pointer text-body text-tx">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-small text-faint">
            {description}
          </p>
        ) : null}
      </div>
      <Switch.Root
        id={switchId}
        name={name}
        checked={checked}
        onCheckedChange={onCheckedChange}
        onBlur={onBlur}
        disabled={disabled}
        aria-describedby={descriptionId}
        className="focus-ring inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-pill border border-bd-2 bg-surface-2 p-0.5 transition disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-pri data-[state=checked]:bg-pri"
      >
        <Switch.Thumb className="block size-4.5 rounded-pill bg-mut shadow-sm transition data-[state=checked]:translate-x-5 data-[state=checked]:bg-white" />
      </Switch.Root>
    </div>
  );
}
