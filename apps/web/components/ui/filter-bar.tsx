'use client';

import { ChevronDown, LayoutGrid, List, type LucideIcon } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from './badge';
import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { IconButton } from './icon-button';

export type FilterOption = { value: string; label: string; count?: number };

export type FilterDef = {
  key: string;
  label: string;
  icon: LucideIcon;
  kind: 'select' | 'sort';
  /** `undefined` while the options load. */
  options?: FilterOption[];
  error?: boolean;
};

type FilterBarProps = {
  filters: FilterDef[];
  value: Record<string, unknown>;
  onChange: (patch: Record<string, string | undefined>) => void;
  search?: ReactNode;
  view?: 'grid' | 'list';
  onViewChange?: (view: 'grid' | 'list') => void;
  className?: string;
};

const ANY = '__any__';

function current(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];
  return raw === undefined || raw === null || raw === '' ? undefined : String(raw);
}

function triggerText(def: FilterDef, chosen: FilterOption | undefined): string {
  if (def.error) return `${def.label}: couldn't load options`;
  if (!def.options) return `${def.label}: loading…`;
  return chosen ? `${def.label}: ${chosen.label}` : def.label;
}

export function FilterBar({
  filters,
  value,
  onChange,
  search,
  view,
  onViewChange,
  className,
}: FilterBarProps) {
  const root = useRef<HTMLDivElement>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const active = filters.filter((f) => f.kind === 'select' && current(value, f.key) !== undefined);

  // A chip or Clear all is about to unmount under keyboard focus: move it to the filter's
  // menu, or, while that menu is disabled, to the first control in the bar.
  function refocus(key: string | undefined) {
    const trigger = key ? triggers.current.get(key) : undefined;
    if (trigger && !trigger.disabled) trigger.focus();
    else root.current?.querySelector<HTMLElement>('input, button:not([disabled])')?.focus();
  }

  function remove(key: string) {
    onChange({ [key]: undefined });
    refocus(key);
  }

  function clearAll() {
    onChange(Object.fromEntries(active.map((def) => [def.key, undefined])));
    refocus(filters.find((def) => def.kind === 'select')?.key);
  }

  return (
    <div ref={root} className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2.5 rounded-card border border-bd bg-surface p-3">
        {search ? <div className="min-w-44 flex-1">{search}</div> : null}
        {filters.map((def) => {
          const selected = current(value, def.key);
          const chosen = def.options?.find((o) => o.value === selected);
          return (
            <DropdownMenu key={def.key}>
              <DropdownMenuTrigger asChild disabled={!def.options || def.error}>
                <Button
                  ref={(node: HTMLButtonElement | null) => {
                    if (node) triggers.current.set(def.key, node);
                    else triggers.current.delete(def.key);
                  }}
                  variant="secondary"
                  size="sm"
                  icon={def.icon}
                  className={cn(
                    'h-10 bg-bg',
                    def.kind === 'select' && chosen && 'border-pri/40 text-pri',
                  )}
                >
                  {triggerText(def, chosen)}
                  <ChevronDown aria-hidden className="text-faint" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-auto max-w-80 min-w-56">
                <DropdownMenuRadioGroup
                  value={selected ?? ANY}
                  onValueChange={(next) => onChange({ [def.key]: next === ANY ? undefined : next })}
                >
                  {def.kind === 'select' ? (
                    <DropdownMenuRadioItem value={ANY}>Any</DropdownMenuRadioItem>
                  ) : null}
                  {def.options?.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      <span className="flex-1 truncate">{option.label}</span>
                      {option.count !== undefined ? (
                        <span className="font-mono text-caption tracking-normal text-faint">
                          {option.count.toLocaleString('en-US')}
                        </span>
                      ) : null}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
        {onViewChange ? (
          <div className="flex gap-1">
            <IconButton
              icon={LayoutGrid}
              label="Grid view"
              variant="ghost"
              aria-pressed={view === 'grid'}
              onClick={() => onViewChange('grid')}
              className="aria-pressed:bg-pri-dim aria-pressed:text-pri"
            />
            <IconButton
              icon={List}
              label="List view"
              variant="ghost"
              aria-pressed={view === 'list'}
              onClick={() => onViewChange('list')}
              className="aria-pressed:bg-pri-dim aria-pressed:text-pri"
            />
          </div>
        ) : null}
      </div>
      {active.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {active.map((def) => {
            const selected = current(value, def.key) ?? '';
            const label = def.options?.find((o) => o.value === selected)?.label ?? selected;
            return (
              <Badge
                key={def.key}
                tone="primary"
                bordered
                dot={false}
                label={label}
                onDismiss={() => remove(def.key)}
              />
            );
          })}
          {active.length > 1 ? (
            <Button size="sm" variant="ghost" onClick={clearAll}>
              Clear all
            </Button>
          ) : null}
        </div>
      ) : null}
      <span aria-live="polite" className="sr-only">
        {active.length === 0
          ? ''
          : `${active.length} ${active.length === 1 ? 'filter' : 'filters'} active`}
      </span>
    </div>
  );
}
