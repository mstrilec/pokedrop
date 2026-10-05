'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

type SearchInputProps = {
  value: string;
  onSearch: (query: string) => void;
  /** Every text the field holds, typed or adopted, before the debounce. */
  onInput?: (text: string) => void;
  label?: string;
  placeholder?: string;
  debounceMs?: number;
  loading?: boolean;
  resultCount?: number;
  variant?: 'inline' | 'topbar';
  /** The API's limit for `q`; the browser stops typing and cuts a paste there. */
  maxLength?: number;
  className?: string;
};

function spoken(count: number): string {
  if (count === 0) return 'No results';
  return count === 1 ? '1 result' : `${count.toLocaleString('en-US')} results`;
}

export function SearchInput({
  value,
  onSearch,
  onInput,
  label = 'Search cards',
  placeholder = 'Search…',
  debounceMs = 300,
  loading = false,
  resultCount,
  variant = 'inline',
  maxLength = 100,
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
      onInput?.(value);
    }
  }, [value, onInput]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function emit(next: string, now: boolean) {
    clearTimeout(timer.current);
    // Trimmed, because the URL schema trims: an untrimmed emit would come back as a
    // different value and overwrite the space the user just typed.
    const send = () => {
      const query = next.trim();
      emitted.current = query;
      onSearch(query);
    };
    if (now) send();
    else timer.current = setTimeout(send, debounceMs);
  }

  function clear() {
    setText('');
    onInput?.('');
    emit('', true);
    input.current?.focus();
  }

  return (
    <div className={cn('relative', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span className="pointer-events-none absolute top-1/2 left-3 flex -translate-y-1/2 text-faint">
        {loading ? (
          <Spinner size={16} label="Searching" />
        ) : (
          <Search aria-hidden className="size-4" />
        )}
      </span>
      <input
        ref={input}
        id={id}
        type="search"
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        maxLength={maxLength}
        onChange={(event) => {
          setText(event.target.value);
          onInput?.(event.target.value);
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
