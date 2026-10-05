'use client';

import type { TradeParty } from '@pokedrop/shared';
import { UserSearch } from 'lucide-react';
import { type KeyboardEvent, useId, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useUserSearch } from '@/lib/query/users';
import { useDebounced } from '@/lib/use-debounced';
import { cn } from '@/lib/utils';

export function CounterpartyPicker({
  value,
  onChange,
  locked,
}: {
  value: TradeParty | null;
  onChange: (party: TradeParty | null) => void;
  locked: boolean;
}) {
  const inputId = useId();
  const listId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = useDebounced(text.trim(), 300);
  const search = useUserSearch(query);
  const results = query.length >= 2 ? (search.data ?? []) : [];
  const showList = open && query.length >= 2;

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-small text-mut">Trade with</span>
        <div className="flex items-center gap-3 rounded-control border border-bd-2 bg-surface px-3 py-2">
          <Avatar name={value.displayName} src={value.avatarUrl} size={32} decorative />
          <span className="min-w-0 flex-1 truncate font-semibold text-tx">{value.displayName}</span>
          {locked ? null : (
            <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
              Change
            </Button>
          )}
        </div>
      </div>
    );
  }

  const choose = (party: TradeParty) => {
    onChange(party);
    setText('');
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(0, results.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && showList && results[active]) {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const optionId = (id: string) => `${listId}-${id}`;

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-small text-mut">
        Trade with
      </label>
      <div className="relative">
        <UserSearch
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
        />
        <input
          id={inputId}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && results[active] ? optionId(results[active].id) : undefined
          }
          autoComplete="off"
          value={text}
          placeholder="Search collectors by name…"
          maxLength={64}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
          className="focus-ring h-10 w-full rounded-control border border-bd-2 bg-bg pr-3 pl-10 text-body text-tx placeholder:text-faint"
        />
      </div>
      {text.trim().length === 1 ? (
        <p className="text-[12px] text-faint">Type at least 2 characters</p>
      ) : null}
      <ul
        id={listId}
        role="listbox"
        aria-label="Collectors"
        hidden={!showList}
        className="absolute top-full z-20 mt-1 flex w-full flex-col overflow-hidden rounded-control border border-bd-2 bg-surface shadow-lg"
      >
        {search.isFetching && results.length === 0 ? (
          <li role="presentation" className="px-3 py-2 text-small text-mut">
            Searching…
          </li>
        ) : results.length === 0 ? (
          <li role="presentation" className="px-3 py-2 text-small text-mut">
            No collectors match
          </li>
        ) : (
          results.map((party, index) => (
            <li
              key={party.id}
              id={optionId(party.id)}
              role="option"
              aria-selected={index === active}
              // Keep the input focused, so the blur does not close the list before the choice.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(party);
              }}
              className={cn(
                'flex cursor-pointer items-center gap-3 px-3 py-2 text-small text-tx',
                index === active && 'bg-pri-dim',
              )}
            >
              <Avatar name={party.displayName} src={party.avatarUrl} size={28} decorative />
              <span className="truncate">{party.displayName}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
