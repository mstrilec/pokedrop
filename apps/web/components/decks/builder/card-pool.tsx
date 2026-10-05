'use client';

import type { Card, PlayableCard } from '@pokedrop/shared';
import { Droplet, Grid3x3, PackageOpen, SearchX, Star } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';
import { VirtualCardGrid } from '@/components/collection/virtual-card-grid';
import { addRefusal } from '@/components/decks/deck-rules';
import { ListError } from '@/components/list-states';
import { EmptyState } from '@/components/ui/empty-state';
import { type FilterDef, FilterBar } from '@/components/ui/filter-bar';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { collectionView } from '@/lib/name-match';
import { useCatalogBrowse, useCatalogFacets } from '@/lib/query/catalog';
import { type Owned, useInventory, useOwnedCounts } from '@/lib/query/inventory';
import { countIn, useDeckDraft } from '@/lib/stores/deck-draft';
import { cn } from '@/lib/utils';
import { PoolTile } from './pool-tile';

type Source = 'mine' | 'all';
type PoolFilters = { q?: string; set?: string; rarity?: string; type?: string };
type RenderTile = (card: PlayableCard, owned: Owned | undefined) => ReactNode;

const SOURCES: { value: Source; label: string }[] = [
  { value: 'mine', label: 'My cards' },
  { value: 'all', label: 'All cards' },
];

function sameBesidesQ(a: PoolFilters, b: PoolFilters): boolean {
  return a.set === b.set && a.rarity === b.rarity && a.type === b.type;
}

function playable(card: Card): PlayableCard {
  const { id, setId, name, supertype, subtypes, types, hp, rarity, imageSmall } = card;
  const { latestPriceUsd, latestPriceEur, priceUpdatedAt, legalities } = card;
  return {
    ...{ id, setId, name, supertype, subtypes, types, hp, rarity, imageSmall },
    ...{ latestPriceUsd, latestPriceEur, priceUpdatedAt, legalities },
  };
}

type Answer = {
  pending: boolean;
  error: unknown;
  hasData: boolean;
  total: number;
  current: boolean;
  stale: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  retry: () => void;
};

type SourceProps = {
  filters: PoolFilters;
  typed: string;
  renderTile: RenderTile;
  scrollElement: HTMLElement | null;
  empty: (filtered: boolean) => ReactNode;
};

function PoolResults<T>({
  answer,
  items,
  getKey,
  render,
  scrollElement,
  empty,
}: {
  answer: Answer;
  items: T[];
  getKey: (item: T) => string;
  render: (item: T) => ReactNode;
  scrollElement: HTMLElement | null;
  empty: ReactNode;
}) {
  if (answer.pending) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading cards"
        className="grid grid-cols-2 gap-4 sm:grid-cols-3"
      >
        {Array.from({ length: 6 }, (_, slot) => (
          <Skeleton key={slot} shape="block" className="aspect-[5/8]" />
        ))}
      </div>
    );
  }
  if (answer.error && !answer.hasData) {
    return <ListError error={answer.error} onRetry={answer.retry} />;
  }
  if (answer.total === 0 && !answer.current) {
    return (
      <p
        role="status"
        aria-busy="true"
        className="flex items-center justify-center gap-2 py-12 text-small text-mut"
      >
        <Spinner size={16} /> Searching…
      </p>
    );
  }
  if (answer.total === 0) return empty;
  return (
    <div
      aria-busy={answer.stale || undefined}
      className={cn('transition-opacity', answer.stale && 'opacity-50')}
    >
      <VirtualCardGrid
        items={items}
        getKey={getKey}
        renderTile={render}
        label="Card pool"
        minTileWidth={100}
        hasMore={answer.current && answer.hasMore}
        loadingMore={answer.loadingMore}
        onLoadMore={answer.loadMore}
        scrollElement={scrollElement}
      />
    </div>
  );
}

function MinePool({ filters, typed, renderTile, scrollElement, empty }: SourceProps) {
  const list = useInventory(filters);
  const pages = list.data?.pages ?? [];
  const answered = pages[0]?.answeredFor;
  const view = collectionView({
    items: pages.flatMap((page) => page.items),
    nameOf: (entry) => entry.card.name,
    typed,
    answeredQ: answered?.q ?? '',
    otherFiltersMatch: answered === undefined || sameBesidesQ(answered, filters),
    placeholder: list.isPlaceholderData,
  });
  const loadMore = () => {
    if (list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) {
      void list.fetchNextPage();
    }
  };
  return (
    <PoolResults
      answer={{
        pending: list.isPending,
        error: list.error,
        hasData: list.data !== undefined,
        total: pages[0]?.total ?? 0,
        current: view.current,
        stale: view.stale,
        hasMore: list.hasNextPage,
        loadingMore: list.isFetchingNextPage,
        loadMore,
        retry: () => void list.refetch(),
      }}
      items={view.items}
      getKey={(entry) => entry.id}
      render={(entry) =>
        renderTile(entry.card, { quantity: entry.quantity, available: entry.availableQuantity })
      }
      scrollElement={scrollElement}
      empty={empty(Boolean(filters.q || filters.set || filters.rarity || filters.type))}
    />
  );
}

function AllPool({ filters, typed, renderTile, scrollElement, empty }: SourceProps) {
  const list = useCatalogBrowse(filters);
  const pages = list.data?.pages ?? [];
  const answered = pages[0]?.answeredFor;
  const view = collectionView({
    items: pages.flatMap((page) => page.items),
    nameOf: (card) => card.name,
    typed,
    answeredQ: answered?.q ?? '',
    otherFiltersMatch: answered === undefined || sameBesidesQ(answered, filters),
    placeholder: list.isPlaceholderData,
  });
  const { owned, known } = useOwnedCounts(
    pages.map((page) => page.items.map((card) => card.id)),
    true,
  );
  const loadMore = () => {
    if (list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) {
      void list.fetchNextPage();
    }
  };
  return (
    <PoolResults
      answer={{
        pending: list.isPending,
        error: list.error,
        hasData: list.data !== undefined,
        total: pages[0]?.total ?? 0,
        current: view.current,
        stale: view.stale,
        hasMore: list.hasNextPage,
        loadingMore: list.isFetchingNextPage,
        loadMore,
        retry: () => void list.refetch(),
      }}
      items={view.items}
      getKey={(card) => card.id}
      render={(card) =>
        renderTile(
          playable(card),
          known.has(card.id) ? (owned.get(card.id) ?? { quantity: 0, available: 0 }) : undefined,
        )
      }
      scrollElement={scrollElement}
      empty={empty(true)}
    />
  );
}

export function CardPool({
  scrollElement,
  dragEnabled,
}: {
  scrollElement: HTMLElement | null;
  dragEnabled: boolean;
}) {
  const [source, setSource] = useState<Source>('mine');
  const [filters, setFilters] = useState<PoolFilters>({});
  const [typed, setTyped] = useState('');
  const [said, setSaid] = useState('');
  const facets = useCatalogFacets();
  const cards = useDeckDraft((s) => s.draft.cards);
  const cardsById = useDeckDraft((s) => s.cardsById);
  const add = useDeckDraft((s) => s.add);

  const onAdd = useCallback(
    (card: PlayableCard, available?: number) => {
      add(card, available);
      setSaid(`Added ${card.name}`);
    },
    [add],
  );

  const renderTile: RenderTile = (card, owned) => (
    <PoolTile
      card={card}
      owned={owned}
      inDeck={countIn(cards, card.id)}
      refusal={addRefusal(card, cards, cardsById)}
      onAdd={onAdd}
      draggable={dragEnabled}
    />
  );

  const clear = () => {
    setFilters({});
    setTyped('');
  };
  const empty = (filtered: boolean) =>
    filtered ? (
      <EmptyState
        icon={SearchX}
        tone="neutral"
        title="No cards match"
        body="Try another name, set, rarity or type."
        cta={{ label: 'Clear filters', onClick: clear }}
      />
    ) : (
      <EmptyState
        icon={PackageOpen}
        title="No cards of your own yet"
        body="Build from every card in the catalog instead, as a theorycraft deck."
        cta={{ label: 'Show all cards', onClick: () => setSource('all') }}
      />
    );

  const filterDefs: FilterDef[] = [
    {
      key: 'set',
      label: 'Set',
      icon: Grid3x3,
      kind: 'select',
      options: facets.data?.sets,
      error: facets.isError,
    },
    {
      key: 'rarity',
      label: 'Rarity',
      icon: Star,
      kind: 'select',
      options: facets.data?.rarities,
      error: facets.isError,
    },
    {
      key: 'type',
      label: 'Type',
      icon: Droplet,
      kind: 'select',
      options: facets.data?.types,
      error: facets.isError,
    },
  ];
  const props: SourceProps = { filters, typed, renderTile, scrollElement, empty };

  return (
    <div className="flex flex-col gap-4">
      <a
        href="#deck-list"
        className="focus-ring sr-only rounded-control bg-pri-strong px-3 py-1.5 text-small text-on-pri focus:not-sr-only focus:self-start"
      >
        Skip to deck
      </a>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-h3">Card pool</h2>
        <div
          role="group"
          aria-label="Cards to show"
          className="flex rounded-control border border-bd-2 p-0.5"
        >
          {SOURCES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={source === option.value}
              onClick={() => setSource(option.value)}
              className={cn(
                'focus-ring h-8 cursor-pointer rounded-tag px-3 text-small font-medium text-mut transition',
                source === option.value && 'bg-pri-dim font-semibold text-pri',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <FilterBar
        filters={filterDefs}
        value={filters}
        onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
        search={
          <SearchInput
            value={filters.q ?? ''}
            onSearch={(q) => setFilters((current) => ({ ...current, q: q || undefined }))}
            onInput={setTyped}
            label="Search the pool"
            placeholder="Search pool…"
            maxLength={100}
          />
        }
      />
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
      {source === 'mine' ? <MinePool {...props} /> : <AllPool {...props} />}
    </div>
  );
}
