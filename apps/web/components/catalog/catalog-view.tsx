'use client';

import { type Card, CardSearchQuerySchema, type CardSort } from '@pokedrop/shared';
import { ArrowDownWideNarrow, Droplet, Grid3x3, SearchX, Star } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { CardTile } from '@/components/cards/card-tile';
import { cardView } from '@/components/cards/card-data';
import { VirtualCardGrid } from '@/components/collection/virtual-card-grid';
import { ListError } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { type FilterDef, FilterBar } from '@/components/ui/filter-bar';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { collectionView } from '@/lib/name-match';
import { type CatalogFilters, useCatalogBrowse, useCatalogFacets } from '@/lib/query/catalog';
import { useOwnedCounts } from '@/lib/query/inventory';
import { useSession } from '@/lib/session/context';
import { useUrlState } from '@/lib/url-state';
import { cn } from '@/lib/utils';

const CatalogUrlSchema = CardSearchQuerySchema.pick({
  q: true,
  set: true,
  rarity: true,
  type: true,
  sort: true,
});

const SORT_LABELS: Record<CardSort, string> = { name_asc: 'Name A–Z', name_desc: 'Name Z–A' };

const count = new Intl.NumberFormat('en-US');

function sameFiltersBesidesQ(a: CatalogFilters, b: CatalogFilters): boolean {
  return a.set === b.set && a.rarity === b.rarity && a.type === b.type && a.sort === b.sort;
}

export function CatalogView() {
  const signedIn = useSession() !== null;
  const [query, setQuery] = useUrlState(CatalogUrlSchema);
  const filters: CatalogFilters = {
    q: query.q,
    set: query.set,
    rarity: query.rarity,
    type: query.type,
    sort: query.sort,
  };
  const list = useCatalogBrowse(filters);
  const facets = useCatalogFacets();
  const [typed, setTyped] = useState(query.q ?? '');

  const pages = list.data?.pages ?? [];
  const cards = pages.flatMap((page) => page.items);
  const total = pages[0]?.total ?? 0;
  const answeredFor = pages[0]?.answeredFor;
  const {
    items: shown,
    stale,
    current,
  } = collectionView({
    items: cards,
    nameOf: (card) => card.name,
    typed,
    answeredQ: answeredFor?.q ?? '',
    otherFiltersMatch: answeredFor === undefined || sameFiltersBesidesQ(answeredFor, filters),
    placeholder: list.isPlaceholderData,
  });
  const { owned, known } = useOwnedCounts(
    pages.map((page) => page.items.map((card) => card.id)),
    signedIn,
  );
  const filtered = Boolean(filters.q || filters.set || filters.rarity || filters.type);

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
    {
      key: 'sort',
      label: 'Sort',
      icon: ArrowDownWideNarrow,
      kind: 'sort',
      options: Object.entries(SORT_LABELS).map(([value, label]) => ({ value, label })),
    },
  ];

  const loadMore = () => {
    if (current && list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) {
      void list.fetchNextPage();
    }
  };

  const renderTile = (card: Card) => {
    const mine = owned.get(card.id);
    // Signed out, ownership is not the question; signed in, a card is "not owned" only once
    // its page's counts have answered.
    const ownedCount = !signedIn || !known.has(card.id) ? undefined : (mine?.quantity ?? 0);
    return (
      <CardTile
        card={cardView(card)}
        owned={ownedCount}
        locked={mine ? mine.quantity - mine.available : 0}
        sizes="(min-width: 1024px) 180px, 45vw"
      />
    );
  };

  let content: ReactNode;
  if (list.isPending) {
    content = (
      <div
        aria-busy="true"
        aria-label="Loading cards"
        className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6"
      >
        {Array.from({ length: 12 }, (_, slot) => (
          <Skeleton key={slot} shape="block" className="aspect-[5/8]" />
        ))}
      </div>
    );
  } else if (list.isError && !list.data) {
    content = <ListError error={list.error} onRetry={() => void list.refetch()} />;
  } else if (total === 0 && !current) {
    content = (
      <p
        role="status"
        aria-busy="true"
        className="flex items-center justify-center gap-2 py-16 text-small text-mut"
      >
        <Spinner size={16} /> Searching…
      </p>
    );
  } else if (total === 0) {
    content = (
      <EmptyState
        icon={SearchX}
        tone="neutral"
        title="No cards match"
        body={filtered ? 'Try a different name, set or rarity.' : 'The catalog is empty.'}
        cta={
          filtered
            ? {
                label: 'Clear filters',
                onClick: () =>
                  setQuery({ q: undefined, set: undefined, rarity: undefined, type: undefined }),
              }
            : undefined
        }
      />
    );
  } else {
    content = (
      <div
        aria-busy={stale || undefined}
        className={cn('transition-opacity', stale && 'opacity-50')}
      >
        <VirtualCardGrid<Card>
          items={shown}
          getKey={(card) => card.id}
          label="Cards"
          renderTile={renderTile}
          hasMore={current && list.hasNextPage}
          loadingMore={list.isFetchingNextPage}
          onLoadMore={loadMore}
        />
        <div className="mt-6 flex flex-col items-center gap-3">
          <p role="status" className="text-small text-mut">
            {list.isFetchingNextPage ? (
              <span className="inline-flex items-center gap-2">
                <Spinner size={16} /> Loading more…
              </span>
            ) : (
              `Showing ${count.format(cards.length)} of ${count.format(total)} cards`
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
      <PageHeader
        title="Browse cards"
        description={
          signedIn
            ? 'Every card in the catalog, including the ones you do not own yet.'
            : 'Every card in the catalog. Sign in to see which ones you own.'
        }
      />
      <FilterBar
        className="mb-6"
        search={
          <SearchInput
            value={query.q ?? ''}
            onSearch={(q) => setQuery({ q: q || undefined }, { history: 'replace' })}
            onInput={setTyped}
            loading={list.isFetching && !list.isFetchingNextPage}
            resultCount={current ? total : undefined}
            placeholder="Search every card…"
          />
        }
        filters={filterDefs}
        value={query}
        onChange={setQuery}
      />
      {content}
    </>
  );
}
