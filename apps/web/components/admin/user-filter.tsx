'use client';

import { X } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { useAdminUsers } from '@/lib/query/admin';
import { useDebounced } from '@/lib/use-debounced';

/**
 * `value` is a user id from the URL; `label` is the name the caller already knows for it (from
 * the rows the filter produced), so a shared link still reads well without another request.
 */
export function UserFilter({
  label,
  value,
  valueLabel,
  extra,
  onChange,
}: {
  label: string;
  value: string | undefined;
  valueLabel: string | undefined;
  /** An extra choice offered first, e.g. `{ value: 'system', label: 'System' }`. */
  extra?: { value: string; label: string };
  onChange: (value: string | undefined) => void;
}) {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 300);
  const users = useAdminUsers({ q: q || undefined, pageSize: 6 });
  const matches = q.length > 0 ? (users.data?.items ?? []) : [];

  if (value !== undefined) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-small text-mut">{label}</span>
        <span className="flex h-10 items-center gap-1 self-start rounded-pill border border-bd-2 bg-surface-2 py-1 pr-1 pl-3 text-small text-tx">
          <span className="max-w-52 truncate">{valueLabel ?? value}</span>
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => onChange(undefined)}
            className="focus-ring flex size-6 cursor-pointer items-center justify-center rounded-pill text-mut hover:text-tx"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="relative flex min-w-56 flex-col">
      <Input
        label={label}
        placeholder="Name or email"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {(extra || matches.length > 0) && (q.length > 0 || extra) ? (
        <ul
          aria-label={`${label} choices`}
          className="mt-1 flex flex-col rounded-control border border-bd bg-bg"
        >
          {extra && (q.length === 0 || extra.label.toLowerCase().includes(q.toLowerCase())) ? (
            <li>
              <button
                type="button"
                onClick={() => onChange(extra.value)}
                className="focus-ring w-full cursor-pointer px-3 py-2 text-left text-small text-tx hover:bg-surface-2"
              >
                {extra.label}
              </button>
            </li>
          ) : null}
          {matches.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => {
                  setText('');
                  onChange(user.id);
                }}
                className="focus-ring flex w-full cursor-pointer flex-col px-3 py-2 text-left text-small hover:bg-surface-2"
              >
                <span className="text-tx">{user.displayName || '(no name)'}</span>
                <span className="text-[11.5px] text-mut">{user.email}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
