'use client';

import { Tabs as TabsPrimitive } from 'radix-ui';
import { type ReactNode, useMemo } from 'react';
import { z } from 'zod';
import { useUrlState } from '@/lib/url-state';
import { cn } from '@/lib/utils';

export type TabItem<V extends string = string> = { value: V; label: string; count?: number };

type TabsProps<V extends string> = {
  tabs: readonly TabItem<V>[];
  value: V;
  onValueChange: (value: V) => void;
  /** Names the tab list for assistive tech, e.g. "Trades". */
  label: string;
  children?: ReactNode;
  className?: string;
};

export function Tabs<V extends string>({
  tabs,
  value,
  onValueChange,
  label,
  children,
  className,
}: TabsProps<V>) {
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={(next) => onValueChange(next as V)}
      className={cn('flex flex-col gap-4', className)}
    >
      <TabsPrimitive.List aria-label={label} className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            className="focus-ring inline-flex h-9 cursor-pointer items-center gap-2 rounded-control border border-bd bg-surface px-3.5 text-small font-medium text-mut transition hover:text-tx data-[state=active]:border-pri/30 data-[state=active]:bg-pri-dim data-[state=active]:font-semibold data-[state=active]:text-pri"
          >
            {tab.label}
            {tab.count !== undefined ? (
              <>
                {/* Read as "Sent 2", not "Sent2"; a flex container drops the space visually. */}{' '}
                <span className="font-mono text-caption tracking-normal">{tab.count}</span>
              </>
            ) : null}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  );
}

export function TabsPanel({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <TabsPrimitive.Content value={value} className={cn('focus-ring rounded-card', className)}>
      {children}
    </TabsPrimitive.Content>
  );
}

/** The selected tab lives in `?<param>=`; the first value is the default and stays out of the URL. */
export function useUrlTab<V extends string>(
  param: string,
  values: readonly [V, ...V[]],
): [V, (value: V) => void] {
  // Keyed by content, so a caller may pass an inline array without re-creating the schema.
  const key = values.join('|');
  const schema = useMemo(() => {
    const list = key.split('|') as [V, ...V[]];
    return z.object({ [param]: z.enum(list).catch(list[0]) });
  }, [param, key]);
  const [state, set] = useUrlState(schema);
  return [state[param] as V, (value: V) => set({ [param]: value })];
}
