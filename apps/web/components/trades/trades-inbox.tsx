'use client';

import { TRADE_TABS, type TradeTab, type TradeView } from '@pokedrop/shared';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Hourglass,
  Inbox,
  Plus,
  Send,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ListError, LoadMore } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsPanel, useUrlTab } from '@/components/ui/tabs';
import { TRADE_STATUS_STYLES } from '@/lib/design/status';
import { timeAgo } from '@/lib/format';
import { useAcceptTrade, useDeclineTrade, useTradeCount, useTrades } from '@/lib/query/trades';
import { toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { expiryText, sides, useMinute } from './trade-summary';

const TAB_LABELS: Record<TradeTab, string> = {
  all: 'All',
  incoming: 'Incoming',
  sent: 'Sent',
  completed: 'Completed',
};

const EMPTY: Record<TradeTab, { title: string; body: string; propose: boolean }> = {
  all: {
    title: 'No trades yet',
    body: 'Offer cards or coins to another collector, and their answer lands here.',
    propose: true,
  },
  incoming: {
    title: 'Nothing waiting on you',
    body: 'Offers other collectors send you appear here until you answer them.',
    propose: false,
  },
  sent: {
    title: 'No offers out',
    body: 'Trades you propose wait here until the other side answers.',
    propose: true,
  },
  completed: {
    title: 'No finished trades yet',
    body: 'Accepted, declined, countered, cancelled and expired trades are kept here.',
    propose: false,
  },
};

type Pending = { trade: TradeView; action: 'accept' | 'decline' } | null;

function TradeRow({
  trade,
  now,
  onAnswer,
}: {
  trade: TradeView;
  now: number;
  onAnswer: (pending: Pending) => void;
}) {
  const incoming = trade.role === 'recipient';
  const other = incoming ? trade.initiator : trade.recipient;
  const { give, get } = sides(trade);
  const status = TRADE_STATUS_STYLES[trade.status];
  const answerable = incoming && trade.status === 'PENDING';

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-bd bg-surface p-4 transition hover:bg-surface-2">
      <Link
        href={`/trades/${trade.id}`}
        className="focus-ring flex min-w-0 flex-1 basis-80 items-center gap-4 rounded-tag"
      >
        <Avatar name={other.displayName} src={other.avatarUrl} size={40} decorative />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold text-tx">{other.displayName}</span>
            <span
              className={cn(
                'rounded-tag px-1.5 py-0.5 font-mono text-[10px] leading-4 font-semibold',
                incoming ? 'bg-pri-dim text-pri' : 'bg-surface-2 text-mut',
              )}
            >
              {incoming ? 'IN' : 'OUT'}
            </span>
            <span className="text-small text-faint">{timeAgo(trade.createdAt)}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small">
            <span className="flex min-w-0 items-center gap-1 text-mut">
              <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-red" />
              <span className="sr-only">You give:</span>
              <span className="truncate">{give}</span>
            </span>
            <ArrowLeftRight aria-hidden className="size-3.5 shrink-0 text-faint" />
            <span className="flex min-w-0 items-center gap-1 text-tx">
              <ArrowDownLeft aria-hidden className="size-3.5 shrink-0 text-grn" />
              <span className="sr-only">You get:</span>
              <span className="truncate">{get}</span>
            </span>
          </span>
        </div>
      </Link>
      <div className="ml-auto flex items-center gap-3">
        {trade.expiresAt ? (
          <time
            dateTime={trade.expiresAt.toISOString()}
            title={trade.expiresAt.toLocaleString('en-GB')}
            className="flex items-center gap-1 text-small text-gold"
          >
            <Hourglass aria-hidden className="size-3.5" />
            {expiryText(trade.expiresAt, now)}
          </time>
        ) : null}
        <Badge label={status.label} tone={status.tone} />
        {answerable ? (
          <>
            <Button
              size="sm"
              variant="confirm"
              icon={Check}
              aria-label={`Accept the trade from ${other.displayName}`}
              onClick={() => onAnswer({ trade, action: 'accept' })}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={X}
              aria-label={`Decline the trade from ${other.displayName}`}
              onClick={() => onAnswer({ trade, action: 'decline' })}
            >
              Decline
            </Button>
          </>
        ) : (
          <ChevronRight aria-hidden className="size-4 text-faint" />
        )}
      </div>
    </li>
  );
}

function TradeList({ tab, onAnswer }: { tab: TradeTab; onAnswer: (pending: Pending) => void }) {
  const list = useTrades(tab);
  const now = useMinute();
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  if (list.isPending) {
    return (
      <ul aria-busy="true" aria-label="Loading trades" className="flex flex-col gap-3">
        {[0, 1, 2].map((slot) => (
          <li key={slot}>
            <Skeleton shape="block" height="5rem" />
          </li>
        ))}
      </ul>
    );
  }
  if (list.isError) return <ListError error={list.error} onRetry={() => void list.refetch()} />;
  if (items.length === 0) {
    const empty = EMPTY[tab];
    return (
      <EmptyState
        icon={tab === 'sent' ? Send : Inbox}
        title={empty.title}
        body={empty.body}
        cta={
          empty.propose ? { label: 'Propose a trade', href: '/trades/new', icon: Plus } : undefined
        }
      />
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-3">
        {items.map((trade) => (
          <TradeRow key={trade.id} trade={trade} now={now} onAnswer={onAnswer} />
        ))}
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
  );
}

export function TradesInbox() {
  const [tab, setTab] = useUrlTab('tab', TRADE_TABS);
  const incoming = useTradeCount('incoming');
  const sent = useTradeCount('sent');
  const accept = useAcceptTrade();
  const decline = useDeclineTrade();
  const [pending, setPending] = useState<Pending>(null);

  const counts: Partial<Record<TradeTab, number>> = { incoming: incoming.data, sent: sent.data };
  const answering = pending?.action === 'accept' ? accept : decline;
  const other = pending?.trade.initiator.displayName ?? '';
  const summary = pending ? sides(pending.trade) : null;

  const confirm = () => {
    if (!pending) return;
    const { trade, action } = pending;
    answering.mutate(trade.id, {
      onSuccess: () => {
        setPending(null);
        toastSuccess(
          action === 'accept'
            ? `Traded with ${trade.initiator.displayName}`
            : `Declined ${trade.initiator.displayName}’s offer`,
        );
      },
    });
  };

  return (
    <>
      <PageHeader
        title="Trades"
        description={
          incoming.data !== undefined && sent.data !== undefined
            ? `${incoming.data} waiting on you · ${sent.data} waiting on others · offered cards stay locked while a trade is open`
            : 'Offered cards stay locked while a trade is open.'
        }
        actions={
          <Button asChild icon={Plus}>
            <Link href="/trades/new">Propose trade</Link>
          </Button>
        }
      />
      <Tabs
        label="Trades"
        value={tab}
        onValueChange={setTab}
        tabs={TRADE_TABS.map((value) => ({
          value,
          label: TAB_LABELS[value],
          count: counts[value],
        }))}
      >
        <TabsPanel value={tab}>
          <TradeList tab={tab} onAnswer={setPending} />
        </TabsPanel>
      </Tabs>
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        tone={pending?.action === 'accept' ? 'success' : 'danger'}
        icon={pending?.action === 'accept' ? Check : X}
        title={
          pending?.action === 'accept' ? `Accept ${other}’s trade?` : `Decline ${other}’s trade?`
        }
        description={
          pending?.action === 'accept'
            ? 'The cards and coins change hands at once; this cannot be undone.'
            : `${other}’s offered cards are released back to them.`
        }
        confirmLabel={pending?.action === 'accept' ? 'Accept trade' : 'Decline trade'}
        confirming={answering.isPending}
        onConfirm={confirm}
      >
        {summary ? (
          <dl className="flex flex-col gap-2 rounded-control border border-bd bg-bg p-3 text-small">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-mut">You give</dt>
              <dd className="text-tx">{summary.give}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-mut">You get</dt>
              <dd className="text-tx">{summary.get}</dd>
            </div>
          </dl>
        ) : null}
      </Dialog>
    </>
  );
}
