'use client';

import type { PackHistoryEntry } from '@pokedrop/shared';
import { PackageOpen, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { CardTile } from '@/components/cards/card-tile';
import { cardView } from '@/components/cards/card-data';
import { ListError, LoadMore } from '@/components/list-states';
import { CurrencyPill } from '@/components/ui/currency-pill';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { isHighRarity, rarityTier } from '@/lib/design/rarity';
import { dateTime } from '@/lib/format';
import { usePackHistory } from '@/lib/query/packs';

const TILE_SIZES = '(min-width: 1024px) 160px, 30vw';

function Opening({ entry }: { entry: PackHistoryEntry }) {
  const highPulls = entry.cards.filter((pull) => isHighRarity(rarityTier(pull.rarity))).length;
  return (
    <li
      id={`opening-${entry.openingId}`}
      tabIndex={-1}
      className="scroll-mt-20 rounded-card border border-bd bg-surface p-5 outline-none focus:ring-2 focus:ring-pri"
    >
      <header className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-h3 font-semibold">{entry.templateName}</h2>
        <time dateTime={entry.createdAt.toISOString()} className="text-small text-mut">
          {dateTime(entry.createdAt)}
        </time>
        {highPulls > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-pill border border-rarity-ultra-border bg-rarity-ultra-tint px-2.5 py-0.5 text-caption font-semibold text-rarity-ultra">
            <Sparkles aria-hidden className="size-3.5" />
            {highPulls === 1 ? '1 big pull' : `${highPulls} big pulls`}
          </span>
        ) : null}
        <span className="ml-auto">
          {entry.cost === null ? (
            <span className="text-small text-faint">Cost not recorded</span>
          ) : (
            <CurrencyPill amount={entry.cost} size="sm" interactive={false} animate={false} />
          )}
        </span>
      </header>
      <ul
        aria-label={`Cards pulled from ${entry.templateName}`}
        className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8"
      >
        {entry.cards.map((pull) => (
          <li key={pull.position}>
            <CardTile card={cardView({ ...pull.card, rarity: pull.rarity })} sizes={TILE_SIZES} />
          </li>
        ))}
      </ul>
    </li>
  );
}

function HistorySkeleton() {
  return (
    <ul aria-hidden className="flex flex-col gap-4">
      {[0, 1].map((row) => (
        <li key={row} className="rounded-card border border-bd bg-surface p-5">
          <Skeleton width="14rem" height="1.25rem" className="mb-4" />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
            {Array.from({ length: 8 }, (_, card) => (
              <Skeleton key={card} shape="block" className="aspect-[5/8]" />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

// The wallet links an opening as #opening-<id>: page through until it is loaded, then show it.
function useOpeningFromHash(history: ReturnType<typeof usePackHistory>) {
  const found = useRef(false);
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = history;
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (found.current || !id.startsWith('opening-') || !data) return;
    const element = document.getElementById(id);
    if (element) {
      found.current = true;
      element.scrollIntoView({ block: 'start' });
      element.focus({ preventScroll: true });
    } else if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [data, hasNextPage, isFetchingNextPage, fetchNextPage]);
}

export function PackHistory() {
  const history = usePackHistory();
  useOpeningFromHash(history);

  if (history.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading your openings">
        <HistorySkeleton />
      </div>
    );
  }
  if (history.isError)
    return <ListError error={history.error} onRetry={() => void history.refetch()} />;

  const openings = history.data.pages.flatMap((page) => page.items);
  const total = history.data.pages[0]?.total ?? 0;
  if (openings.length === 0) {
    return (
      <EmptyState
        icon={PackageOpen}
        title="No packs opened yet"
        body="Every pack you open lands here, with everything it held."
        cta={{ label: 'Open your first pack', href: '/packs', icon: PackageOpen }}
      />
    );
  }

  return (
    <>
      <ol className="flex flex-col gap-4">
        {openings.map((entry) => (
          <Opening key={entry.openingId} entry={entry} />
        ))}
      </ol>
      <LoadMore
        shown={openings.length}
        total={total}
        noun={total === 1 ? 'opening' : 'openings'}
        hasMore={history.hasNextPage}
        loading={history.isFetchingNextPage}
        onLoad={() => void history.fetchNextPage()}
      />
    </>
  );
}
