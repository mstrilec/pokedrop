'use client';

import type { InventoryCard } from '@pokedrop/shared';
import { useId, useState } from 'react';
import { CardArt } from '@/components/cards/card-art';
import { cardView, setNumber } from '@/components/cards/card-data';
import { VirtualCardGrid } from '@/components/collection/virtual-card-grid';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { SearchInput } from '@/components/ui/search-input';
import { useCatalogBrowse } from '@/lib/query/catalog';
import { useInventory } from '@/lib/query/inventory';
import { cn } from '@/lib/utils';
import { type ComposerState, pickRefusal, type Side, summaryOf } from './composer-state';

function PickTile({
  card,
  badge,
  refusal,
  onPick,
}: {
  card: InventoryCard;
  badge?: string;
  refusal: string | null;
  onPick: () => void;
}) {
  const reasonId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-label={`Add ${card.name} (${setNumber(card.id)})${badge ? `, ${badge}` : ''}`}
        aria-disabled={refusal !== null || undefined}
        aria-describedby={refusal !== null ? reasonId : undefined}
        onClick={() => {
          if (refusal === null) onPick();
        }}
        className={cn(
          'focus-ring block overflow-hidden rounded-tile border border-bd bg-surface text-left transition hover:border-pri',
          refusal !== null && 'cursor-not-allowed opacity-50 grayscale',
        )}
      >
        <span className="relative block aspect-[5/7]">
          <CardArt card={cardView(card)} sizes="120px" />
          {badge ? (
            <span className="absolute top-2 right-2 rounded-tag bg-black/50 px-1.5 py-0.5 font-mono text-[10px] leading-4 font-semibold text-white">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="block truncate border-t border-bd px-2 py-1.5 text-small font-semibold text-tx">
          {card.name}
        </span>
      </button>
      {refusal !== null ? (
        <p id={reasonId} className="text-[11px] leading-4 text-faint">
          {refusal}
        </p>
      ) : null}
    </div>
  );
}

type ResultsProps = {
  q: string;
  state: ComposerState;
  counterpartyName: string;
  scroller: HTMLElement | null;
  pick: (card: InventoryCard) => void;
};

function Status({ children }: { children: string }) {
  return <p className="py-8 text-center text-small text-mut">{children}</p>;
}

function MyCards({ q, state, counterpartyName, scroller, pick }: ResultsProps) {
  const list = useInventory({ q: q || undefined });
  const entries = list.data?.pages.flatMap((page) => page.items) ?? [];
  if (list.isPending) return <Status>Loading your cards…</Status>;
  if (entries.length === 0)
    return <Status>{q ? 'No cards of yours match' : 'You have no cards yet'}</Status>;
  return (
    <VirtualCardGrid
      items={entries}
      getKey={(entry) => entry.id}
      label="Your cards"
      minTileWidth={110}
      hasMore={list.hasNextPage}
      loadingMore={list.isFetchingNextPage}
      onLoadMore={() => void list.fetchNextPage()}
      scrollElement={scroller}
      renderTile={(entry) => {
        const locked = entry.quantity - entry.availableQuantity;
        return (
          <PickTile
            card={entry.card}
            badge={locked > 0 ? `×${entry.quantity} · ${locked} locked` : `×${entry.quantity}`}
            refusal={pickRefusal(
              state,
              'give',
              entry.card,
              entry.availableQuantity,
              counterpartyName,
            )}
            onPick={() => pick(entry.card)}
          />
        );
      }}
    />
  );
}

function CatalogCards({ q, state, counterpartyName, scroller, pick }: ResultsProps) {
  const list = useCatalogBrowse({ q: q || undefined });
  const cards = list.data?.pages.flatMap((page) => page.items) ?? [];
  if (list.isPending) return <Status>Loading the catalog…</Status>;
  if (cards.length === 0) return <Status>No cards match</Status>;
  return (
    <VirtualCardGrid
      items={cards}
      getKey={(card) => card.id}
      label="Catalog cards"
      minTileWidth={110}
      hasMore={list.hasNextPage}
      loadingMore={list.isFetchingNextPage}
      onLoadMore={() => void list.fetchNextPage()}
      scrollElement={scroller}
      renderTile={(card) => {
        const summary = summaryOf(card);
        return (
          <PickTile
            card={summary}
            refusal={pickRefusal(state, 'get', summary, undefined, counterpartyName)}
            onPick={() => pick(summary)}
          />
        );
      }}
    />
  );
}

export function CardPickerDialog({
  side,
  state,
  counterpartyName,
  showcase,
  onPick,
  onClose,
}: {
  side: Side | null;
  state: ComposerState;
  counterpartyName: string;
  showcase: InventoryCard[];
  onPick: (side: Side, card: InventoryCard) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [said, setSaid] = useState('');
  const give = side === 'give';

  const pick = (card: InventoryCard) => {
    if (!side) return;
    onPick(side, card);
    setSaid(
      `Added ${card.name} ${give ? 'to what you give' : `to what ${counterpartyName} gives`}`,
    );
  };
  const props: ResultsProps = { q, state, counterpartyName, scroller, pick };

  return (
    <Dialog
      open={side !== null}
      onOpenChange={(open) => {
        if (!open) {
          setQ('');
          onClose();
        }
      }}
      title={give ? 'Add a card you give' : `Add a card ${counterpartyName} gives`}
      description={
        give
          ? 'Only copies not promised to another trade can be offered.'
          : `${counterpartyName}’s collection is private: pick any card; the trade can only be accepted if they have it.`
      }
      className="max-w-180"
    >
      <div className="flex flex-col gap-4">
        <SearchInput
          value={q}
          onSearch={setQ}
          label={give ? 'Search your cards' : 'Search the catalog'}
          placeholder="Search by name…"
          maxLength={100}
        />
        <p aria-live="polite" className="sr-only">
          {said}
        </p>
        <div ref={setScroller} className="overflow-y-auto pr-1" style={{ height: '55dvh' }}>
          {!give && showcase.length > 0 && q === '' ? (
            <section
              aria-label={`On ${counterpartyName}’s showcase`}
              className="mb-5 flex flex-col gap-3"
            >
              <h3 className="text-small font-semibold text-mut">
                On {counterpartyName}’s showcase
              </h3>
              <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
                {showcase.map((card) => (
                  <PickTile
                    key={card.id}
                    card={card}
                    refusal={pickRefusal(state, 'get', card, undefined, counterpartyName)}
                    onPick={() => pick(card)}
                  />
                ))}
              </div>
              <h3 className="text-small font-semibold text-mut">Every card</h3>
            </section>
          ) : null}
          {side === null ? null : give ? <MyCards {...props} /> : <CatalogCards {...props} />}
        </div>
        <Button onClick={onClose} className="self-end">
          Done
        </Button>
      </div>
    </Dialog>
  );
}
