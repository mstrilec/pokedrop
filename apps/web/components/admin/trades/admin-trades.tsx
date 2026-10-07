'use client';

import { TradeStatusSchema, type TradeView } from '@pokedrop/shared';
import { ArrowRight, Flag } from 'lucide-react';
import Link from 'next/link';
import { z } from 'zod';
import { ListError, LoadMore } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import { TRADE_STATUS_STYLES } from '@/lib/design/status';
import { dateTime } from '@/lib/format';
import { useAdminTrades } from '@/lib/query/admin';
import { useUrlState } from '@/lib/url-state';
import { namedSides } from '@/components/trades/trade-summary';
import { UserFilter } from '../user-filter';

const STATUS_TABS = ['all', ...TradeStatusSchema.options] as const;
const Day = z.iso.date().optional().catch(undefined);
const FiltersSchema = z.object({
  status: z.enum(STATUS_TABS).catch('all').default('all'),
  user: z.string().min(1).max(64).optional().catch(undefined),
  from: Day,
  to: Day,
});

function partyName(trades: TradeView[], id: string | undefined) {
  if (!id) return undefined;
  const row = trades.find((t) => t.initiator.id === id || t.recipient.id === id);
  return row ? (row.initiator.id === id ? row.initiator : row.recipient).displayName : undefined;
}

export function AdminTrades() {
  const [filters, setFilters] = useUrlState(FiltersSchema);
  const range =
    filters.from && filters.to && filters.from > filters.to
      ? {}
      : { from: filters.from, to: filters.to };
  const list = useAdminTrades({
    status: filters.status === 'all' ? undefined : filters.status,
    user: filters.user,
    ...range,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const filtered = filters.status !== 'all' || filters.user || filters.from || filters.to;

  return (
    <>
      <PageHeader
        title="Trade moderation"
        description="Every trade between collectors, newest first. Open one to see its history or void it."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <UserFilter
          label="Collector"
          value={filters.user}
          valueLabel={partyName(items, filters.user)}
          onChange={(user) => setFilters({ user })}
        />
        <Input
          label="From"
          type="date"
          value={filters.from ?? ''}
          onChange={(e) => setFilters({ from: e.target.value })}
          className="w-40"
        />
        <Input
          label="To"
          type="date"
          value={filters.to ?? ''}
          onChange={(e) => setFilters({ to: e.target.value })}
          className="w-40"
        />
      </div>
      <Tabs
        label="Status"
        value={filters.status}
        onValueChange={(status) => setFilters({ status })}
        tabs={STATUS_TABS.map((value) => ({
          value,
          label: value === 'all' ? 'All' : TRADE_STATUS_STYLES[value].label,
        }))}
      >
        <TabsPanel value={filters.status}>
          {list.isPending ? (
            <ul aria-busy="true" aria-label="Loading trades" className="flex flex-col gap-3">
              {[0, 1, 2].map((slot) => (
                <li key={slot}>
                  <Skeleton shape="block" height="4.5rem" />
                </li>
              ))}
            </ul>
          ) : list.isError ? (
            <ListError error={list.error} onRetry={() => void list.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Flag}
              tone="neutral"
              title="No trades match"
              body="Widen the dates, choose another status or clear the collector."
              cta={
                filtered
                  ? {
                      label: 'Clear filters',
                      onClick: () =>
                        setFilters({
                          status: 'all',
                          user: undefined,
                          from: undefined,
                          to: undefined,
                        }),
                    }
                  : undefined
              }
            />
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {items.map((trade) => {
                  const sides = namedSides(trade);
                  const status = TRADE_STATUS_STYLES[trade.status];
                  return (
                    <li key={trade.id}>
                      <Link
                        href={`/admin/trades/${trade.id}`}
                        className="focus-ring flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-bd bg-surface p-4 transition hover:bg-surface-2"
                      >
                        <span className="flex min-w-0 flex-1 basis-80 flex-col gap-1 text-small">
                          <span className="truncate text-tx">
                            <b className="font-semibold">{trade.initiator.displayName}</b> gives{' '}
                            {sides.initiator}
                          </span>
                          <span className="flex min-w-0 items-center gap-1 truncate text-mut">
                            <ArrowRight aria-hidden className="size-3.5 shrink-0" />
                            <b className="font-semibold text-tx">
                              {trade.recipient.displayName}
                            </b>{' '}
                            gives {sides.recipient}
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-1 text-[11.5px] text-faint">
                          <Badge label={status.label} tone={status.tone} />
                          <span>created {dateTime(trade.createdAt)}</span>
                          {trade.resolvedAt ? (
                            <span>closed {dateTime(trade.resolvedAt)}</span>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <LoadMore
                shown={items.length}
                total={total}
                noun={total === 1 ? 'trade' : 'trades'}
                hasMore={list.hasNextPage}
                loading={list.isFetchingNextPage}
                onLoad={() => void list.fetchNextPage()}
              />
            </>
          )}
        </TabsPanel>
      </Tabs>
    </>
  );
}
