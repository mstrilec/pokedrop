'use client';

import { Gem, Grid3x3, Layers, Sparkle } from 'lucide-react';
import { useState } from 'react';
import { formatUsd } from '@/components/cards/card-data';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { CompletionMeter } from '@/components/ui/completion-meter';
import { StatCard } from '@/components/ui/stat-card';
import { useInventorySummary } from '@/lib/query/inventory';

const count = new Intl.NumberFormat('en-US');
const SETS_SHOWN = 6;

export function InventoryHeader() {
  const summary = useInventorySummary();
  const [allSets, setAllSets] = useState(false);
  const data = summary.data;
  const sets = data?.setCompletion ?? [];

  return (
    <>
      <PageHeader
        title="Your collection"
        description={
          data
            ? `${count.format(data.totalCards)} cards · ${count.format(data.uniqueCards)} unique · worth ${formatUsd(data.collectionValueUsd)}, ${count.format(data.pricedCards)} of ${count.format(data.uniqueCards)} priced`
            : summary.isError
              ? 'Totals are unavailable right now.'
              : 'Counting your cards…'
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total cards"
          icon={Layers}
          tone="primary"
          loading={summary.isPending}
          value={data ? count.format(data.totalCards) : '—'}
        />
        <StatCard
          label="Unique"
          icon={Sparkle}
          tone="accent"
          loading={summary.isPending}
          value={data ? count.format(data.uniqueCards) : '—'}
        />
        <StatCard
          label="Collection value"
          icon={Gem}
          tone="success"
          loading={summary.isPending}
          value={data ? formatUsd(data.collectionValueUsd) : '—'}
        />
        <StatCard
          label="Sets started"
          icon={Grid3x3}
          tone="warning"
          loading={summary.isPending}
          value={data ? count.format(sets.length) : '—'}
        />
      </div>
      {sets.length > 0 ? (
        <section
          aria-labelledby="sets-heading"
          className="mb-8 rounded-card border border-bd bg-surface p-5"
        >
          <h2 id="sets-heading" className="mb-4 text-caption text-faint uppercase">
            Set completion
          </h2>
          <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {(allSets ? sets : sets.slice(0, SETS_SHOWN)).map((set) => (
              <li key={set.setId}>
                <CompletionMeter label={set.name} value={set.owned} max={set.total} />
              </li>
            ))}
          </ul>
          {sets.length > SETS_SHOWN ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-4"
              aria-expanded={allSets}
              onClick={() => setAllSets((shown) => !shown)}
            >
              {allSets ? 'Show fewer sets' : `Show all ${count.format(sets.length)} sets`}
            </Button>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
