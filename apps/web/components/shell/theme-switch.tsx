'use client';

import { type LucideIcon, Monitor, Moon, Sun } from 'lucide-react';
import { useId } from 'react';
import type { ThemePreference } from '@/lib/theme/theme';
import { useTheme } from '@/lib/theme/theme-provider';
import { cn } from '@/lib/utils';

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

/** System · Light · Dark as native radios, so arrow keys move between them. */
export function ThemeSwitch({ size }: { size: 'labelled' | 'icon' }) {
  const { preference, setPreference } = useTheme();
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex gap-1 rounded-control border border-bd bg-surface-2 p-1"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <label
          key={value}
          className={cn(
            'relative flex cursor-pointer items-center gap-2 rounded-sm text-small font-semibold text-mut transition-colors hover:text-tx has-checked:bg-surface has-checked:text-tx has-checked:shadow-sm has-focus-visible:ring-2 has-focus-visible:ring-ring',
            size === 'icon' ? 'size-8 justify-center' : 'h-8 px-3',
          )}
        >
          <input
            type="radio"
            name={name}
            value={value}
            checked={preference === value}
            onChange={() => setPreference(value)}
            className="sr-only"
          />
          <Icon aria-hidden className="size-4" />
          <span className={size === 'icon' ? 'sr-only' : undefined}>{label}</span>
        </label>
      ))}
    </div>
  );
}
