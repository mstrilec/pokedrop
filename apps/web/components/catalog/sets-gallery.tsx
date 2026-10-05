'use client';

import type { CardSet } from '@pokedrop/shared';
import Image from 'next/image';
import Link from 'next/link';
import { ListError } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { CompletionMeter } from '@/components/ui/completion-meter';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, useUrlTab } from '@/components/ui/tabs';
import { isOptimizable } from '@/lib/images';
import { useSets } from '@/lib/query/catalog';
import { useInventorySummary } from '@/lib/query/inventory';
import { useSession } from '@/lib/session/context';

const ORDERS = ['newest', 'oldest', 'series'] as const;
const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const count = new Intl.NumberFormat('en-US');
const GRID = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

type Completion = { owned: number; total: number };

function SetCard({ set, completion }: { set: CardSet; completion: Completion | null | undefined }) {
  return (
    <Link
      href={`/cards?set=${encodeURIComponent(set.id)}`}
      className="focus-ring flex h-full flex-col gap-4 rounded-card border border-bd bg-surface p-5 transition hover:-translate-y-1 hover:border-pri"
    >
      <span className="relative block h-14">
        {set.logoUrl ? (
          <Image
            src={set.logoUrl}
            alt=""
            fill
            sizes="220px"
            unoptimized={!isOptimizable(set.logoUrl)}
            className="object-contain object-left"
          />
        ) : null}
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-h3 font-semibold text-tx">{set.name}</span>
        <span className="text-small text-mut">
          {set.series} · {day.format(set.releaseDate)} · {count.format(set.printedTotal)} cards
        </span>
      </span>
      {completion === undefined ? null : completion === null ? (
        <Skeleton width="100%" height="1.75rem" />
      ) : (
        <CompletionMeter
          label={`${set.name} completion`}
          value={completion.owned}
          max={completion.total}
          className="mt-auto"
        />
      )}
    </Link>
  );
}

export function SetsGallery() {
  const signedIn = useSession() !== null;
  const [order, setOrder] = useUrlTab('order', ORDERS);
  const sets = useSets();
  const summary = useInventorySummary(signedIn);

  const progress = new Map(
    (summary.data?.setCompletion ?? []).map((set) => [set.setId, set] as const),
  );
  // Signed out: no meter. Signed in: the summary's own figures, or 0 of the printed total for a
  // set the collection has nothing from — the summary counts against printedTotal too.
  const completionOf = (set: CardSet): Completion | null | undefined => {
    if (!signedIn) return undefined;
    if (!summary.data) return null;
    const known = progress.get(set.id);
    return known
      ? { owned: known.owned, total: known.total }
      : { owned: 0, total: set.printedTotal };
  };

  const list = [...(sets.data ?? [])].sort((a, b) =>
    order === 'oldest'
      ? a.releaseDate.getTime() - b.releaseDate.getTime()
      : b.releaseDate.getTime() - a.releaseDate.getTime(),
  );
  // Series in the order of their newest release; sets within one newest first.
  const series = [...new Set(list.map((set) => set.series))];

  const started = summary.data?.setCompletion.length ?? 0;
  const complete = summary.data?.setCompletion.filter((set) => set.owned >= set.total).length ?? 0;
  const description = !sets.data
    ? 'Every expansion in the catalog.'
    : signedIn && summary.data
      ? `${count.format(sets.data.length)} sets · ${count.format(started)} started · ${count.format(complete)} complete`
      : `${count.format(sets.data.length)} sets, from the first expansion to the newest.`;

  return (
    <>
      <PageHeader title="Sets" description={description} />
      <Tabs
        tabs={[
          { value: 'newest', label: 'Newest first' },
          { value: 'oldest', label: 'Oldest first' },
          { value: 'series', label: 'By series' },
        ]}
        value={order}
        onValueChange={setOrder}
        label="Order sets"
      >
        {sets.isPending ? (
          <ul aria-busy="true" aria-label="Loading sets" className={GRID}>
            {Array.from({ length: 8 }, (_, slot) => (
              <li key={slot}>
                <Skeleton shape="block" height="11rem" />
              </li>
            ))}
          </ul>
        ) : sets.isError ? (
          <ListError error={sets.error} onRetry={() => void sets.refetch()} />
        ) : order === 'series' ? (
          <div className="flex flex-col gap-8">
            {series.map((name) => (
              <section key={name} aria-labelledby={`series-${name}`}>
                <h2 id={`series-${name}`} className="mb-3 text-h3 font-semibold">
                  {name}
                </h2>
                <ul className={GRID}>
                  {list
                    .filter((set) => set.series === name)
                    .map((set) => (
                      <li key={set.id}>
                        <SetCard set={set} completion={completionOf(set)} />
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <ul className={GRID}>
            {list.map((set) => (
              <li key={set.id}>
                <SetCard set={set} completion={completionOf(set)} />
              </li>
            ))}
          </ul>
        )}
      </Tabs>
    </>
  );
}
