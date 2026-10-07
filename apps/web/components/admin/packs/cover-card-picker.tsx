'use client';

import type { Card } from '@pokedrop/shared';
import { useState } from 'react';
import { CardTile } from '@/components/cards/card-tile';
import { cardView } from '@/components/cards/card-data';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { SearchInput } from '@/components/ui/search-input';
import { useCatalogBrowse, useSets } from '@/lib/query/catalog';
import { cn } from '@/lib/utils';

/** Picks a pack's featured card from the template's own sets. */
export function CoverCardPicker({
  open,
  setIds,
  onPick,
  onClose,
}: {
  open: boolean;
  setIds: string[];
  onPick: (card: Card) => void;
  onClose: () => void;
}) {
  const sets = useSets();
  const [chosenSet, setChosenSet] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const setId = chosenSet !== null && setIds.includes(chosenSet) ? chosenSet : (setIds[0] ?? '');
  const browse = useCatalogBrowse({ set: setId, ...(q ? { q } : {}) });
  const cards = browse.data?.pages.flatMap((page) => page.items) ?? [];
  const name = (id: string) => sets.data?.find((set) => set.id === id)?.name ?? id;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Choose the featured card"
      description="Its art goes in the middle of the wrapper, and its type colours it."
      className="max-w-180"
    >
      <div className="flex flex-col gap-4">
        {setIds.length > 1 ? (
          <div role="group" aria-label="Set" className="flex flex-wrap gap-2">
            {setIds.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={id === setId}
                onClick={() => setChosenSet(id)}
                className={cn(
                  'focus-ring cursor-pointer rounded-pill border px-3 py-1 text-small transition',
                  id === setId
                    ? 'border-pri bg-pri-dim text-tx'
                    : 'border-bd-2 text-mut hover:text-tx',
                )}
              >
                {name(id)}
              </button>
            ))}
          </div>
        ) : null}
        <SearchInput
          label={`Search ${name(setId)}`}
          placeholder="Card name…"
          value={q}
          onSearch={(next) => setQ(next.trim())}
          loading={browse.isFetching}
        />
        <div className="overflow-y-auto pr-1" style={{ height: '50dvh' }}>
          {browse.isPending ? (
            <p className="py-8 text-center text-small text-mut">Loading cards…</p>
          ) : cards.length === 0 ? (
            <p className="py-8 text-center text-small text-mut">No card matches.</p>
          ) : (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {cards.map((card) => (
                <li key={card.id}>
                  <CardTile card={cardView(card)} sizes="120px" onSelect={() => onPick(card)} />
                </li>
              ))}
            </ul>
          )}
          {browse.hasNextPage ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mx-auto mt-4 flex"
              loading={browse.isFetchingNextPage}
              onClick={() => void browse.fetchNextPage()}
            >
              Load more
            </Button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
