# PD-94 Inputs, Forms, Search and Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `Input`, `Form`/`FormField`/`FormToggle`, `Toggle`, `SearchInput`, `FilterBar` and the `useUrlState` hook, and prove them in the component gallery against the live API.

**Architecture:** Presentational components in `apps/web/components/ui/`, all controlled. A form layer binds `Input` and `Toggle` to React Hook Form through context. Filter state lives in the URL through `useUrlState(schema)`, which parses search params field by field with the shared Zod query schemas; pages pass that state into the controlled `FilterBar`. Facet options come from `GET /facets` through a TanStack Query hook.

**Tech Stack:** Next.js 16.3 App Router, React 19.2, Tailwind v4 tokens from `app/globals.css`, Radix (`radix-ui`), React Hook Form 7 + `@hookform/resolvers` 5, Zod 4, TanStack Query 5.

**Spec:** `docs/superpowers/specs/2026-10-04-pd-94-inputs-and-forms-design.md`

## Global Constraints

- **No automated tests in v1.** No test files, runners or test dependencies. Every task is checked by `pnpm --filter @pokedrop/web typecheck`, `pnpm lint` and, in Task 6, measurements in the gallery. Where the skill template says "write the failing test", this plan says "verify".
- Commits go straight to `dev`, subject `[PD-94]: lowercase description`, header ≤ 72 characters, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Import `cn` from `@/lib/utils` only (lint enforces it).
- No hex values and no arbitrary spacing lengths in class strings (lint enforces it); colors are tokens (`bg-bg`, `border-bd-2`, `text-red`, `bg-pri` …), radii are `rounded-control`, `rounded-pill`, `rounded-tag`, `rounded-card`.
- Code comments only where an innocent-looking edit would break something silently; rationale goes in `docs/Components.md`.
- New dependencies: `react-hook-form` 7.x and `@hookform/resolvers` 5.x in `apps/web` only. No Fuse.js.
- History: discrete filter changes `push`, search `replace`.
- Facets URL is `GET /api/v1/facets` (measured 2026-10-04: `/facets` 200, `/catalog/facets` 404).

## Review Focus

1. **Typing while an earlier debounced search lands.** The URL update for `char` arrives while the user has typed `chari`; the field must keep `chari`, not snap back. Pinned in Task 4 (adopt an outside `value` only when it differs from the last value this input emitted) and measured in Task 6.
2. **A hand-edited or stale URL.** `?sort=nonsense&rarity=Rare`, `?rarity=%00`, `?minQuantity=abc`: each bad field falls back alone, the rest survive, nothing throws. Pinned in Task 1 (`parseUrlState` per field) and measured in Task 6.
3. **Removing a chip with the keyboard.** The chip's button disappears; focus must land somewhere useful, not on `<body>`. Pinned in Task 5 (focus moves to that filter's menu button) and measured in Task 6.
4. **Facets unavailable.** The API is down or slow: the select menus are disabled and say why, search and sort still work. Pinned in Task 5 and measured in Task 6.
5. **Two eyes on a password.** The reveal button must not submit the form and must say its state to a screen reader. Pinned in Task 2 (`type="button"`, `aria-pressed`).

---

### Task 1: Dependencies, URL state, catalog endpoints

**Files:**
- Modify: `apps/web/package.json` (via pnpm)
- Create: `apps/web/lib/url-state.ts`
- Create: `apps/web/lib/api/endpoints/catalog.ts`
- Create: `apps/web/lib/query/catalog.ts`
- Modify: `apps/web/lib/query/keys.ts`
- Modify: `apps/web/lib/toast.ts` (export the message helper)
- Modify: `docs/superpowers/specs/2026-10-04-pd-94-inputs-and-forms-design.md` (facets path)

**Interfaces:**
- Produces: `useUrlState(schema, options?) → [value, set]` where `set(patch: UrlPatch<S>, how?: { history?: 'push' | 'replace' })`, `parseUrlState(schema, params)`, `type UrlPatch<S>` (each schema key optional, its output type or a string or `undefined`); `facets()`, `searchCards(params)`, `type CardSearchParams`; `useCatalogFacets()`; `keys.catalog.facets`, `keys.catalog.search(params)`; `apiErrorMessage(error)`.

- [ ] **Step 1: Install the form libraries**

```bash
pnpm --filter @pokedrop/web add react-hook-form@^7 @hookform/resolvers@^5
```

Expected: both appear under `dependencies` in `apps/web/package.json`.

- [ ] **Step 2: Write `lib/url-state.ts`**

```ts
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

// A string is accepted for any field (a FilterBar speaks strings); the URL is re-parsed on read,
// so a value the schema refuses falls back like any hand-edited link.
export type UrlPatch<S extends z.ZodObject> = {
  [K in keyof z.output<S>]?: z.output<S>[K] | string | undefined;
};
type History = 'push' | 'replace';

function defaultOf(field: z.core.$ZodType): unknown {
  const parsed = z.safeParse(field, undefined);
  return parsed.success ? parsed.data : undefined;
}

// Field by field: one bad value falls back to its own default and leaves the others alone.
export function parseUrlState<S extends z.ZodObject>(
  schema: S,
  params: URLSearchParams,
): z.output<S> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const parsed = z.safeParse(field, params.get(key) ?? undefined);
    out[key] = parsed.success ? parsed.data : defaultOf(field);
  }
  return out as z.output<S>;
}

export function useUrlState<S extends z.ZodObject>(
  schema: S,
  { resets = ['page', 'cursor'] }: { resets?: string[] } = {},
): [z.output<S>, (patch: UrlPatch<S>, how?: { history?: History }) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  const value = useMemo(
    () => parseUrlState(schema, new URLSearchParams(search)),
    [schema, search],
  );

  const set = useCallback(
    (patch: UrlPatch<S>, { history = 'push' }: { history?: History } = {}) => {
      const next = new URLSearchParams(search);
      for (const key of resets) next.delete(key);
      for (const [key, raw] of Object.entries(patch)) {
        const field = schema.shape[key];
        const isDefault = field !== undefined && raw === defaultOf(field);
        if (raw === undefined || raw === null || raw === '' || isDefault) next.delete(key);
        else next.set(key, String(raw));
      }
      const query = next.toString();
      const url = query ? `${pathname}?${query}` : pathname;
      if (history === 'replace') router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [router, pathname, search, schema, resets],
  );

  return [value, set];
}
```

A page must pass a schema declared at module level (not inline), so `useMemo` keeps the parsed value's identity between renders. `resets` defaults to a new array per call; that only re-creates `set`, which is harmless.

- [ ] **Step 3: Write `lib/api/endpoints/catalog.ts`**

```ts
import {
  CardSearchQuerySchema,
  CardSearchResultSchema,
  CatalogFacetsSchema,
} from '@pokedrop/shared';
import type { z } from 'zod';
import { get } from '../core';

export type CardSearchParams = z.input<typeof CardSearchQuerySchema>;

export const facets = () => get('/facets', CatalogFacetsSchema);

export const searchCards = (params: CardSearchParams = {}) =>
  get('/cards', CardSearchResultSchema, params);
```

- [ ] **Step 4: Add the keys in `lib/query/keys.ts`**

Replace the `catalog` line:

```ts
  catalog: {
    all: ['catalog'],
    facets: ['catalog', 'facets'],
    search: (params: CardSearchParams = {}) => ['catalog', 'search', params],
  },
```

and add the import beside the others:

```ts
import type { CardSearchParams } from '@/lib/api/endpoints/catalog';
```

- [ ] **Step 5: Write `lib/query/catalog.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import { facets } from '@/lib/api/endpoints/catalog';
import { keys } from './keys';

// Global counts over the whole mirror; the catalog root's 30-minute stale time applies.
export function useCatalogFacets() {
  return useQuery({ queryKey: keys.catalog.facets, queryFn: () => api.call(facets()) });
}
```

- [ ] **Step 6: Export the error message from `lib/toast.ts`**

Rename `function messageOf(` to `export function apiErrorMessage(` and update its one caller in `toastApiError` (`toast.error(apiErrorMessage(error), …)`).

- [ ] **Step 7: Correct the spec's facets path**

In the spec's *Facets* section replace ``calls `GET /catalog/facets` `` with ``calls `GET /facets` (the catalog controller has no prefix)``.

- [ ] **Step 8: Verify**

Run: `pnpm --filter @pokedrop/web typecheck` → `Types generated successfully`, no errors.
Run: `pnpm lint` → no output after the shared build.
If `z.core.$ZodType` or `z.safeParse` does not typecheck, check `node_modules/zod/v4/classic/external.d.ts` for the exported names and use the equivalents; behaviour must stay: parse with the field's own schema, fall back to the field's default.

- [ ] **Step 9: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/lib docs/superpowers/specs/2026-10-04-pd-94-inputs-and-forms-design.md
git commit -m "[PD-94]: add url state, catalog facets and search, form deps"
```

---

### Task 2: Input and Toggle

**Files:**
- Create: `apps/web/components/ui/input.tsx`
- Create: `apps/web/components/ui/toggle.tsx`

**Interfaces:**
- Produces: `Input(props: InputProps)`, `type InputProps`; `Toggle(props: ToggleProps)`, `type ToggleProps`.

- [ ] **Step 1: Write `components/ui/input.tsx`**

```tsx
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
            {revealed ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
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
```

The reveal button keeps one name, *Show password*, and states its state through `aria-pressed`; changing the name as well would announce the toggle twice. Record this deviation from the spec's wording in Task 6's docs.

- [ ] **Step 2: Write `components/ui/toggle.tsx`**

```tsx
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
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @pokedrop/web typecheck` and `pnpm lint` → both clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/ui/input.tsx apps/web/components/ui/toggle.tsx
git commit -m "[PD-94]: add the input field and the toggle switch"
```

---

### Task 3: The form layer

**Files:**
- Create: `apps/web/components/ui/form.tsx`

**Interfaces:**
- Consumes: `Input`, `InputProps` (Task 2); `Toggle`, `ToggleProps` (Task 2); `apiErrorMessage` (Task 1); `ApiError` from `@/lib/api/core`.
- Produces: `Form<T>`, `FormField<T>`, `FormToggle<T>`, `FormError`, `applyApiError<T>(form, error, fields?)`.

- [ ] **Step 1: Write `components/ui/form.tsx`**

```tsx
'use client';

import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  type FieldPath,
  type FieldValues,
  FormProvider,
  get,
  type SubmitHandler,
  type UseFormReturn,
  useController,
  useFormContext,
} from 'react-hook-form';
import { ApiError } from '@/lib/api/core';
import { apiErrorMessage } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Input, type InputProps } from './input';
import { Toggle, type ToggleProps } from './toggle';

export function Form<T extends FieldValues>({
  form,
  onSubmit,
  children,
  className,
}: {
  form: UseFormReturn<T>;
  onSubmit: SubmitHandler<T>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('flex flex-col gap-4', className)}
      >
        {children}
      </form>
    </FormProvider>
  );
}

export function FormField<T extends FieldValues = FieldValues>({
  name,
  ...props
}: Omit<InputProps, 'name' | 'error'> & { name: FieldPath<T> }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<T>();
  const message: unknown = get(errors, name)?.message;
  return (
    <Input
      {...props}
      {...register(name)}
      error={typeof message === 'string' ? message : undefined}
    />
  );
}

export function FormToggle<T extends FieldValues = FieldValues>({
  name,
  ...props
}: Omit<ToggleProps, 'checked' | 'onCheckedChange' | 'name' | 'onBlur'> & { name: FieldPath<T> }) {
  const { field } = useController<T>({ name });
  return (
    <Toggle
      {...props}
      name={field.name}
      checked={Boolean(field.value)}
      onCheckedChange={field.onChange}
      onBlur={field.onBlur}
    />
  );
}

export function FormError() {
  const {
    formState: { errors },
  } = useFormContext();
  const message = errors.root?.message;
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-center gap-2 rounded-control border border-red/30 bg-red-dim px-3 py-2 text-small text-red"
    >
      <CircleAlert aria-hidden className="size-4 shrink-0" />
      {message}
    </p>
  );
}

export function applyApiError<T extends FieldValues>(
  form: UseFormReturn<T>,
  error: unknown,
  fields: Partial<Record<string, FieldPath<T>>> = {},
): void {
  const field = error instanceof ApiError && error.code ? fields[error.code] : undefined;
  const message = apiErrorMessage(error);
  if (field) form.setError(field, { type: 'server', message }, { shouldFocus: true });
  else form.setError('root', { type: 'server', message });
}
```

`register(name)` is spread after `props`, so its `name`, `onChange`, `onBlur` and `ref` always win.

- [ ] **Step 2: Verify**

Run: `pnpm --filter @pokedrop/web typecheck` and `pnpm lint` → both clean. If `setError('root', …)` does not typecheck for a generic `T`, cast the name as `` 'root' as `root` ``; React Hook Form types `root` as a valid error key on every form.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ui/form.tsx
git commit -m "[PD-94]: bind inputs and toggles to react hook form"
```

---

### Task 4: SearchInput

**Files:**
- Create: `apps/web/components/ui/search-input.tsx`

**Interfaces:**
- Consumes: `Spinner` (`components/ui/spinner.tsx`).
- Produces: `SearchInput(props: SearchInputProps)`.

- [ ] **Step 1: Write `components/ui/search-input.tsx`**

```tsx
'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

type SearchInputProps = {
  value: string;
  onSearch: (query: string) => void;
  label?: string;
  placeholder?: string;
  debounceMs?: number;
  loading?: boolean;
  resultCount?: number;
  variant?: 'inline' | 'topbar';
  className?: string;
};

function spoken(count: number): string {
  if (count === 0) return 'No results';
  return count === 1 ? '1 result' : `${count.toLocaleString('en-US')} results`;
}

export function SearchInput({
  value,
  onSearch,
  label = 'Search cards',
  placeholder = 'Search…',
  debounceMs = 300,
  loading = false,
  resultCount,
  variant = 'inline',
  className,
}: SearchInputProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value);
  const emitted = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Take a value from outside (Back restored an older query), but not the echo of our own
  // last search: that arrives while the user may already have typed further.
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function emit(next: string, now: boolean) {
    clearTimeout(timer.current);
    const send = () => {
      emitted.current = next;
      onSearch(next);
    };
    if (now) send();
    else timer.current = setTimeout(send, debounceMs);
  }

  function clear() {
    setText('');
    emit('', true);
    input.current?.focus();
  }

  return (
    <div className={cn('relative', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span className="pointer-events-none absolute top-1/2 left-3 flex -translate-y-1/2 text-faint">
        {loading ? <Spinner size={16} label="Searching" /> : <Search aria-hidden className="size-4" />}
      </span>
      <input
        ref={input}
        id={id}
        type="search"
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => {
          setText(event.target.value);
          emit(event.target.value, false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && text) {
            event.preventDefault();
            clear();
          }
        }}
        className={cn(
          'focus-ring h-10 w-full rounded-control border border-bd pr-10 pl-10 text-small text-tx transition placeholder:text-faint [&::-webkit-search-cancel-button]:appearance-none',
          variant === 'inline' ? 'bg-bg' : 'bg-surface',
        )}
      />
      {text ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className="focus-ring absolute top-1/2 right-1 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-tag text-mut hover:text-tx"
        >
          <X aria-hidden className="size-4" />
        </button>
      ) : null}
      <span aria-live="polite" className="sr-only">
        {resultCount === undefined ? '' : spoken(resultCount)}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @pokedrop/web typecheck` and `pnpm lint` → both clean. If lint flags the ref write during render, move nothing: the writes above are in effects and handlers, not render.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ui/search-input.tsx
git commit -m "[PD-94]: add the debounced, clearable search input"
```

---

### Task 5: FilterBar

**Files:**
- Create: `apps/web/components/ui/filter-bar.tsx`

**Interfaces:**
- Consumes: `Button` (`button.tsx`), `IconButton` (`icon-button.tsx`), `Badge` (`badge.tsx`), `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem` (`dropdown-menu.tsx`).
- Produces: `FilterBar(props: FilterBarProps)`, `type FilterDef`, `type FilterOption`.

- [ ] **Step 1: Write `components/ui/filter-bar.tsx`**

```tsx
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
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const active = filters.filter((f) => f.kind === 'select' && current(value, f.key) !== undefined);

  function remove(key: string) {
    onChange({ [key]: undefined });
    // The chip's own button is about to disappear; keep keyboard focus on this filter.
    triggers.current.get(key)?.focus();
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
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
                  onValueChange={(next) =>
                    onChange({ [def.key]: next === ANY ? undefined : next })
                  }
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
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onChange(Object.fromEntries(active.map((def) => [def.key, undefined])))
              }
            >
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
```

`Button` forwards `ref` because React 19 passes `ref` as a prop and `Button` spreads its props onto the element; Radix's trigger merges its own ref with ours through `asChild`.

- [ ] **Step 2: Verify**

Run: `pnpm --filter @pokedrop/web typecheck` and `pnpm lint` → both clean. If the `ref` callback's type clashes with `Button`'s props, type it from `React.ComponentProps<'button'>['ref']`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ui/filter-bar.tsx
git commit -m "[PD-94]: add the filter bar with menus, chips and view toggle"
```

---

### Task 6: Gallery, measurements, documentation

**Files:**
- Create: `apps/web/app/(dev)/dev/components/_sections/inputs.tsx`
- Modify: `apps/web/app/(dev)/dev/components/page.tsx`
- Modify: `docs/Components.md`

**Interfaces:**
- Consumes: everything from Tasks 1–5; `Group`, `Row`, `Specimen` from `./frame`; `Button` from PD-92.

- [ ] **Step 1: Write the gallery section**

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CardSearchQuerySchema, CardSortSchema } from '@pokedrop/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownWideNarrow, Droplet, Grid3x3, Star } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { type FilterDef, FilterBar } from '@/components/ui/filter-bar';
import { applyApiError, Form, FormError, FormField, FormToggle } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Toggle } from '@/components/ui/toggle';
import { api } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/core';
import { searchCards } from '@/lib/api/endpoints/catalog';
import { useCatalogFacets } from '@/lib/query/catalog';
import { keys } from '@/lib/query/keys';
import { useUrlState } from '@/lib/url-state';
import { Group, Row, Specimen } from './frame';

const SignInDemoSchema = z.object({
  email: z.email('Enter an email address'),
  password: z.string().min(8, 'At least 8 characters'),
  rememberMe: z.boolean(),
});
type SignInDemo = z.infer<typeof SignInDemoSchema>;

const CatalogFilterSchema = CardSearchQuerySchema.pick({
  q: true,
  set: true,
  rarity: true,
  type: true,
  supertype: true,
  sort: true,
});

const SORT_LABELS: Record<z.output<typeof CardSortSchema>, string> = {
  name_asc: 'Name A–Z',
  name_desc: 'Name Z–A',
};

function SignInDemoForm() {
  const form = useForm<SignInDemo>({
    resolver: zodResolver(SignInDemoSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '', rememberMe: true },
  });

  async function submit(values: SignInDemo) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const error =
      values.email === 'unverified@pokedrop.test'
        ? new ApiError({
            kind: 'api',
            statusCode: 403,
            code: 'EMAIL_NOT_VERIFIED',
            message: 'Verify your email first. We sent you a new link.',
          })
        : new ApiError({
            kind: 'auth',
            statusCode: 401,
            code: 'INVALID_EMAIL_OR_PASSWORD',
            message: 'Invalid email or password',
          });
    applyApiError(form, error, { EMAIL_NOT_VERIFIED: 'email' });
  }

  return (
    <Form form={form} onSubmit={submit} className="max-w-sm">
      <FormField<SignInDemo> name="email" label="Email" type="email" autoComplete="email" />
      <FormField<SignInDemo>
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        help="At least 8 characters."
      />
      <FormToggle<SignInDemo> name="rememberMe" label="Remember me" />
      <FormError />
      <Button type="submit" loading={form.formState.isSubmitting}>
        Sign in
      </Button>
    </Form>
  );
}

function CatalogFilterDemo() {
  const [query, setQuery] = useUrlState(CatalogFilterSchema);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const facets = useCatalogFacets();
  const cards = useQuery({
    queryKey: keys.catalog.search({ ...query, pageSize: 5 }),
    queryFn: () => api.call(searchCards({ ...query, pageSize: 5 })),
  });

  const fromFacets = (list: 'sets' | 'rarities' | 'types' | 'supertypes') =>
    facets.data?.[list];
  const filters: FilterDef[] = [
    { key: 'set', label: 'Set', icon: Grid3x3, kind: 'select', options: fromFacets('sets'), error: facets.isError },
    { key: 'rarity', label: 'Rarity', icon: Star, kind: 'select', options: fromFacets('rarities'), error: facets.isError },
    { key: 'type', label: 'Type', icon: Droplet, kind: 'select', options: fromFacets('types'), error: facets.isError },
    {
      key: 'sort',
      label: 'Sort',
      icon: ArrowDownWideNarrow,
      kind: 'sort',
      options: CardSortSchema.unwrap().options.map((value) => ({ value, label: SORT_LABELS[value] })),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        search={
          <SearchInput
            value={query.q ?? ''}
            onSearch={(q) => setQuery({ q: q || undefined }, { history: 'replace' })}
            loading={cards.isFetching}
            resultCount={cards.data?.total}
            placeholder="Search the catalog…"
          />
        }
        filters={filters}
        value={query}
        onChange={setQuery}
        view={view}
        onViewChange={setView}
      />
      <p className="font-mono text-small text-faint">
        {cards.isError
          ? 'Search failed'
          : cards.data
            ? `${cards.data.total} cards · ${cards.data.items.map((c) => c.name).join(', ')}`
            : 'Loading…'}
      </p>
    </div>
  );
}

export function InputsSection() {
  const [publicProfile, setPublicProfile] = useState(true);
  const [search, setSearch] = useState('');

  return (
    <Group id="inputs" title="Inputs & forms">
      <Specimen name="Input">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Input label="Display name" placeholder="Ash Ketchum" />
          <Input label="Display name" help="Shown on your public profile." defaultValue="Misty" />
          <Input label="Email" type="email" defaultValue="not-an-email" error="Enter an email address" />
          <Input label="Password" type="password" defaultValue="pikachu-123" />
          <Input label="Coins" type="number" mono defaultValue="1250" />
          <Input label="Email" disabled defaultValue="locked@pokedrop.test" />
        </div>
      </Specimen>
      <Specimen name="Toggle">
        <div className="flex max-w-md flex-col gap-4">
          <Toggle
            label="Public profile"
            description="Anyone with the link can see your showcase."
            checked={publicProfile}
            onCheckedChange={setPublicProfile}
          />
          <Toggle label="Show collection value" checked={false} onCheckedChange={() => {}} disabled />
        </div>
      </Specimen>
      <Specimen name="Form (React Hook Form + Zod)">
        <p className="text-small text-faint">
          Submit empty to see Zod errors. unverified@pokedrop.test fails on the field; any other address fails for the
          whole form.
        </p>
        <SignInDemoForm />
      </Specimen>
      <Specimen name="SearchInput">
        <Row label={`Debounced value: "${search}"`}>
          <SearchInput value={search} onSearch={setSearch} resultCount={search ? 3 : undefined} className="w-80" />
        </Row>
      </Specimen>
      <Specimen name="FilterBar (live: URL state, facets and search against the API)">
        <CatalogFilterDemo />
      </Specimen>
    </Group>
  );
}
```

If `CardSortSchema.unwrap()` is not the way to reach the enum behind `.default()` in Zod 4, use `CardSortSchema.removeDefault().options` or the literal list `['name_asc', 'name_desc'] as const`; check with typecheck.

- [ ] **Step 2: Register the section in `page.tsx`**

Add `import { InputsSection } from './_sections/inputs';` and render `<InputsSection />` after `<PrimitivesSection />`.

- [ ] **Step 3: Verify the build**

Run: `pnpm --filter @pokedrop/web typecheck` and `pnpm lint` → both clean; `npx prettier --write apps/web`.

- [ ] **Step 4: Measure** (API on :4000, `next dev` on :3000, gallery at `/dev/components`)

Record each result, with numbers, for the docs:

1. Install a counter: `const n = { push: 0, replace: 0 }; const p = history.pushState, r = history.replaceState; history.pushState = function (...a) { n.push++; return p.apply(this, a); }; history.replaceState = function (...a) { n.replace++; return r.apply(this, a); };` — then type `charizard` with real key events into the catalog search. Expect `push` 0, `replace` ≥ 1 and the network panel to show one `/cards?q=charizard` request after the pause (`read_network_requests` with `urlPattern: '/api/v1/cards'`).
2. Choose *Rare* in Rarity, then a Type, then Back. Expect `rarity=Rare` kept and `type` gone.
3. Remove the Rarity chip with Enter on its button. Expect `rarity` gone from the URL, a new `/cards` request, and `document.activeElement` to be the Rarity menu button. With two filters active, *Clear all* removes both and keeps `sort`.
4. Open `/dev/components?sort=nonsense&rarity=Rare`: Rarity shows *Rare*, Sort shows *Name A–Z*. Open `?rarity=%00`: no rarity chip. Neither throws.
5. Open `?page=3&tab=sent`, choose a set: `page` gone, `tab=sent` kept.
6. Keyboard only from the search box: Tab reaches each menu, the view toggle; Enter opens a menu, arrows move, typing a set name jumps to it, Escape closes it back on its button. Finish animations with `document.getAnimations().forEach(a => a.finish())` if the pane is not drawing.
7. Demo form: submit empty → email has `aria-invalid="true"` and its `aria-describedby` id holds *Enter an email address*; focus is on the email field. `unverified@pokedrop.test` + a valid password → the message under email; any other → the alert above *Sign in*. No toast appears (`document.querySelectorAll('[data-sonner-toast]').length === 0`).
8. Stop the API (`Stop-Process` on the port-4000 listener), reload: Set, Rarity and Type read *couldn't load options* and are disabled; typing in search still changes the URL. Restart the API afterwards.
9. Typing race (Review Focus 1): with the network throttled or not, type `char`, pause 350 ms, type `izard` immediately; the field must read `charizard` throughout.

- [ ] **Step 5: Document in `docs/Components.md`**

Add a section `## Inputs, forms, search and filters (PD-94)` with: the components table (file, props in one line each), `useUrlState` rules (per-field parsing, defaults dropped from the URL, unknown keys kept, `page`/`cursor` reset, push vs replace, Suspense on static pages), the form recipe (`useForm` with `zodResolver` and `mode: 'onTouched'`, `Form`, `FormField<T>`, `FormToggle<T>`, `FormError`, `applyApiError` with `meta: { toast: false }` on the mutation), the sign-up-never-reveals-a-taken-email rule, the password reveal's fixed name with `aria-pressed`, facets at `GET /facets` with global counts, and the measurements from Step 4 dated 2026-10-04.

- [ ] **Step 6: Commit and close**

```bash
git add apps/web/app
git commit -m "[PD-94]: show inputs, forms and a live filter bar in the gallery"
git add docs/Components.md
git commit -m "[PD-94]: document inputs, forms, url state and measurements"
```

Then mark PD-94 Done in Linear.
