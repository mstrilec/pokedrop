'use client';

import type { InventoryEntry } from '@pokedrop/shared';
import {
  ArrowDownWideNarrow,
  Copy,
  Droplet,
  Grid3x3,
  PackageOpen,
  SearchX,
  Star,
} from 'lucide-react';
import { type ReactNode, useState, useSyncExternalStore } from 'react';
import { CardTile } from '@/components/cards/card-tile';
import { cardView } from '@/components/cards/card-data';
import { VirtualCardGrid } from '@/components/collection/virtual-card-grid';
import { ListError } from '@/components/list-states';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { type FilterDef, FilterBar } from '@/components/ui/filter-bar';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { narrowToTyped } from '@/lib/name-match';
import { useCatalogFacets } from '@/lib/query/catalog';
import { type InventoryFilters, useInventory, useInventorySummary } from '@/lib/query/inventory';
import { useUrlState } from '@/lib/url-state';
import { cn } from '@/lib/utils';
import { INVENTORY_COLUMNS, sortingOf, sortOf } from './inventory-columns';
import {
  InventoryUrlSchema,
  SORT_LABELS,
  storedView,
  storeView,
  type View,
} from './inventory-query';

const count = new Intl.NumberFormat('en-US');
const noSubscription = () => () => {};
const ROW_HEIGHT = 69;

function sameFiltersBesidesQ(a: InventoryFilters, b: InventoryFilters): boolean {
  return (
    a.set === b.set &&
    a.rarity === b.rarity &&
    a.type === b.type &&
    a.minQuantity === b.minQuantity &&
    a.sort === b.sort
  );
}

export function InventoryView() {
  const [query, setQuery] = useUrlState(InventoryUrlSchema);
  const stored = useSyncExternalStore(noSubscription, storedView, () => null);
  const view: View = query.view ?? stored ?? 'grid';
  const filters: InventoryFilters = {
    q: query.q,
    set: query.set,
    rarity: query.rarity,
    type: query.type,
    minQuantity: query.minQuantity,
    sort: query.sort,
  };

  const list = useInventory(filters);
  const summary = useInventorySummary();
  const facets = useCatalogFacets();
  const [typed, setTyped] = useState(query.q ?? '');

  const pages = list.data?.pages ?? [];
  const entries = pages.flatMap((page) => page.items);
  const total = pages[0]?.total ?? 0;
  const answeredFor = pages[0]?.answeredFor;
  const narrowed = narrowToTyped(entries, (entry) => entry.card.name, typed, answeredFor?.q ?? '');
  const stale =
    narrowed.stale || (answeredFor !== undefined && !sameFiltersBesidesQ(answeredFor, filters));
  const filtered = Boolean(
    filters.q || filters.set || filters.rarity || filters.type || filters.minQuantity,
  );

  const filterDefs: FilterDef[] = [
    {
      key: 'set',
      label: 'Set',
      icon: Grid3x3,
      kind: 'select',
      options: summary.data?.setCompletion.map((set) => ({
        value: set.setId,
        label: `${set.name} · ${set.owned}/${set.total}`,
      })),
      error: summary.isError,
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
    {
      key: 'minQuantity',
      label: 'Copies',
      icon: Copy,
      kind: 'select',
      options: [
        { value: '2', label: '2+ (duplicates)' },
        { value: '4', label: '4+ (playset)' },
      ],
    },
    {
      key: 'sort',
      label: 'Sort',
      icon: ArrowDownWideNarrow,
      kind: 'sort',
      options: Object.entries(SORT_LABELS).map(([value, label]) => ({ value, label })),
    },
  ];

  const loadMore = () => {
    if (list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) {
      void list.fetchNextPage();
    }
  };

  let content: ReactNode;
  if (list.isPending) {
    content = (
      <div
        aria-busy="true"
        aria-label="Loading your cards"
        className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6"
      >
        {Array.from({ length: 12 }, (_, slot) => (
          <Skeleton key={slot} shape="block" className="aspect-[5/8]" />
        ))}
      </div>
    );
  } else if (list.isError && !list.data) {
    content = <ListError error={list.error} onRetry={() => void list.refetch()} />;
  } else if (total === 0 && !stale) {
    content = filtered ? (
      <EmptyState
        icon={SearchX}
        tone="neutral"
        title="No cards match these filters"
        body="Try a different set, rarity or name."
        cta={{
          label: 'Clear filters',
          onClick: () =>
            setQuery({
              q: undefined,
              set: undefined,
              rarity: undefined,
              type: undefined,
              minQuantity: undefined,
            }),
        }}
      />
    ) : (
      <EmptyState
        icon={PackageOpen}
        title="Your collection is empty"
        body="Every card you pull or trade for lands here."
        cta={{ label: 'Open a pack', href: '/packs', icon: PackageOpen }}
      />
    );
  } else {
    content = (
      <div
        aria-busy={stale || undefined}
        className={cn('transition-opacity', stale && 'opacity-50')}
      >
        {view === 'grid' ? (
          <VirtualCardGrid<InventoryEntry>
            items={narrowed.items}
            getKey={(entry) => entry.id}
            label="Your cards"
            renderTile={(entry) => (
              <CardTile
                card={cardView(entry.card)}
                owned={entry.quantity}
                locked={entry.lockedQuantity}
                sizes="(min-width: 1024px) 180px, 45vw"
              />
            )}
            hasMore={list.hasNextPage}
            loadingMore={list.isFetchingNextPage}
            onLoadMore={loadMore}
          />
        ) : (
          <DataTable
            label="Your cards"
            columns={INVENTORY_COLUMNS}
            data={narrowed.items}
            getRowId={(entry) => entry.id}
            sorting={sortingOf(query.sort)}
            onSortingChange={(updater) => {
              const next = typeof updater === 'function' ? updater(sortingOf(query.sort)) : updater;
              setQuery({ sort: sortOf(next) });
            }}
            virtualize={{ estimateRowHeight: ROW_HEIGHT, totalRows: total, onEndReached: loadMore }}
          />
        )}
        <div className="mt-6 flex flex-col items-center gap-3">
          <p role="status" className="text-small text-mut">
            {list.isFetchingNextPage ? (
              <span className="inline-flex items-center gap-2">
                <Spinner size={16} /> Loading more…
              </span>
            ) : (
              `Showing ${count.format(entries.length)} of ${count.format(total)} cards`
            )}
          </p>
          {list.isFetchNextPageError ? (
            <div role="alert" className="flex items-center gap-3 text-small text-red">
              Couldn&rsquo;t load more.
              <Button variant="secondary" size="sm" onClick={() => void list.fetchNextPage()}>
                Try again
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <FilterBar
        className="mb-6"
        search={
          <SearchInput
            value={query.q ?? ''}
            onSearch={(q) => setQuery({ q: q || undefined }, { history: 'replace' })}
            onInput={setTyped}
            loading={list.isFetching && !list.isFetchingNextPage}
            resultCount={stale ? undefined : total}
            placeholder="Search your cards…"
          />
        }
        filters={filterDefs}
        value={query}
        onChange={setQuery}
        view={view}
        onViewChange={(next) => {
          storeView(next);
          setQuery({ view: next });
        }}
      />
      {content}
    </>
  );
}
