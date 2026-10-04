'use client';

import type { WalletEntry, WalletQuery } from '@pokedrop/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { Coins, Wallet } from 'lucide-react';
import Link from 'next/link';
import { ListError, LoadMore } from '@/components/list-states';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, useUrlTab } from '@/components/ui/tabs';
import { dateTime, formatCoins } from '@/lib/format';
import { useWallet } from '@/lib/query/wallet';
import { cn } from '@/lib/utils';

const FILTERS = ['all', 'grants', 'packs', 'trades'] as const;
type Filter = (typeof FILTERS)[number];

const TYPE_OF: Record<Filter, WalletQuery['type']> = {
  all: undefined,
  grants: 'GRANT',
  packs: 'PACK_SPEND',
  trades: 'TRADE',
};

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'grants', label: 'Grants' },
  { value: 'packs', label: 'Pack spends' },
  { value: 'trades', label: 'Trades' },
] as const;

const EMPTY: Record<Filter, string> = {
  all: 'No coins have moved yet.',
  grants: 'No grants yet.',
  packs: 'No packs opened yet.',
  trades: 'No coins have changed hands in a trade yet.',
};

const full = new Intl.NumberFormat('en-US');

const link = 'focus-ring rounded-tag font-medium text-tx hover:text-pri hover:underline';

function Source({ entry }: { entry: WalletEntry }) {
  const source = entry.source;
  if (source === null) return <span className="text-mut">Source no longer available</span>;
  switch (source.kind) {
    case 'welcome':
      return <span>Welcome grant for verifying your email</span>;
    case 'grant':
      return <span>{entry.amount < 0 ? 'Adjusted by an admin' : 'Granted by an admin'}</span>;
    case 'pack':
      return (
        <Link href={`/packs/history#opening-${source.openingId}`} className={link}>
          Opened {source.templateName}
        </Link>
      );
    case 'trade':
      return (
        <Link href={`/trades/${source.tradeId}`} className={link}>
          {entry.type === 'TRADE_REVERSAL' ? 'Reversed trade' : 'Trade'} with{' '}
          {source.counterparty.displayName}
        </Link>
      );
  }
}

const column = createColumnHelper<WalletEntry>();

const COLUMNS = [
  column.accessor('createdAt', {
    header: 'Date',
    enableSorting: false,
    meta: { width: 'minmax(9rem, 11rem)' },
    cell: (info) => (
      <time dateTime={info.getValue().toISOString()} className="text-small text-mut">
        {dateTime(info.getValue())}
      </time>
    ),
  }),
  column.accessor('source', {
    header: 'What',
    enableSorting: false,
    meta: { width: 'minmax(10rem, 1fr)' },
    cell: (info) => <Source entry={info.row.original} />,
  }),
  column.accessor('amount', {
    header: 'Amount',
    enableSorting: false,
    meta: { width: '7rem', numeric: true },
    cell: (info) => {
      const amount = info.getValue();
      return (
        <span
          className={cn(
            'font-mono font-semibold',
            amount > 0 ? 'text-grn' : amount < 0 ? 'text-red' : 'text-mut',
          )}
        >
          {amount > 0 ? '+' : amount < 0 ? '−' : ''}
          {formatCoins(Math.abs(amount))}
        </span>
      );
    },
  }),
  column.accessor('balanceAfter', {
    header: 'Balance',
    enableSorting: false,
    meta: { width: '7rem', numeric: true },
    cell: (info) => <span className="font-mono text-tx">{formatCoins(info.getValue())}</span>,
  }),
];

export function WalletLedger() {
  const [filter, setFilter] = useUrlTab('type', FILTERS);
  const ledger = useWallet(TYPE_OF[filter]);
  const entries = ledger.data?.pages.flatMap((page) => page.items) ?? [];
  const first = ledger.data?.pages[0];

  return (
    <>
      <section
        aria-labelledby="balance-label"
        aria-busy={ledger.isPending || undefined}
        className="mb-7 flex flex-col gap-2 rounded-card border border-bd bg-surface p-6"
      >
        <h2 id="balance-label" className="text-caption text-faint uppercase">
          Current balance
        </h2>
        {first ? (
          <p className="flex items-center gap-3 text-gold">
            <Coins aria-hidden className="size-7" />
            <span className="font-mono text-[2.25rem] leading-none font-bold">
              {full.format(first.balance)}
            </span>
            <span className="text-body text-mut">coins</span>
          </p>
        ) : (
          <Skeleton width="9rem" height="2.25rem" />
        )}
      </section>

      <Tabs tabs={TABS} value={filter} onValueChange={setFilter} label="Filter transactions">
        {ledger.isError ? (
          <ListError error={ledger.error} onRetry={() => void ledger.refetch()} />
        ) : (
          <>
            <DataTable
              label="Coin transactions, newest first"
              columns={COLUMNS}
              data={entries}
              getRowId={(entry) => entry.id}
              loading={ledger.isPending}
              empty={
                <EmptyState
                  icon={Wallet}
                  tone="economy"
                  title={EMPTY[filter]}
                  body="Every coin you gain or spend appears here, with what caused it."
                  cta={{ label: 'Open a pack', href: '/packs' }}
                  className="border-0"
                />
              }
            />
            {first && entries.length > 0 ? (
              <LoadMore
                shown={entries.length}
                total={first.total}
                noun={first.total === 1 ? 'transaction' : 'transactions'}
                hasMore={ledger.hasNextPage}
                loading={ledger.isFetchingNextPage}
                onLoad={() => void ledger.fetchNextPage()}
              />
            ) : null}
          </>
        )}
      </Tabs>
    </>
  );
}
