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

  const value = useMemo(() => parseUrlState(schema, new URLSearchParams(search)), [schema, search]);

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
