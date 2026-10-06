'use client';

import { MAX_COUNTER_CHAIN, type TradeDetail, type TradeParty } from '@pokedrop/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Hourglass, Info, Repeat, X } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cardView } from '@/components/cards/card-data';
import { ListError } from '@/components/list-states';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/core';
import { TRADE_STATUS_STYLES } from '@/lib/design/status';
import { dateTime, timeAgo } from '@/lib/format';
import { keys } from '@/lib/query/keys';
import { useAcceptTrade, useCancelTrade, useDeclineTrade, useTrade } from '@/lib/query/trades';
import { toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { TradeOfferPanel } from './trade-offer-panel';
import { TradeStatusTimeline, tradeTimelineSteps } from './trade-status-timeline';
import { expiryText, sides, useMinute } from './trade-summary';

type Action = 'accept' | 'decline' | 'cancel';

function statusLine(trade: TradeDetail, other: string): string {
  switch (trade.status) {
    case 'PENDING':
      return trade.role === 'recipient' ? 'Waiting on your answer' : `Waiting on ${other}`;
    case 'ACCEPTED':
      return 'Accepted — the cards and coins changed hands';
    case 'COUNTERED':
      return 'Answered with a counter-offer';
    case 'DECLINED':
      return 'Declined';
    case 'CANCELLED':
      return trade.timeline.at(-1)?.action === 'trade.expire'
        ? 'Expired unanswered'
        : 'Cancelled by its sender';
    case 'VOIDED':
      return 'Voided by an admin';
  }
}

function sideOf(trade: TradeDetail, side: 'OFFERED' | 'REQUESTED') {
  const locked = side === 'OFFERED' && trade.status === 'PENDING';
  return trade.items
    .filter((item) => item.side === side)
    .map((item) => ({ card: cardView(item.card), count: item.quantity, locked }));
}

/** Every offer of the negotiation, oldest first; the parties take turns proposing. */
function Negotiation({
  trade,
  me,
  other,
}: {
  trade: TradeDetail;
  me: TradeParty;
  other: TradeParty;
}) {
  const here = trade.chain.findIndex((entry) => entry.id === trade.id);
  const proposer = trade.role === 'recipient' ? other : me;
  return (
    <section aria-labelledby="negotiation-heading" className="flex flex-col gap-3">
      <h2 id="negotiation-heading" className="text-small font-semibold text-mut">
        Negotiation · {trade.chain.length} offers
      </h2>
      <ol className="flex flex-col gap-2">
        {trade.chain.map((entry, index) => {
          const by = (here - index) % 2 === 0 ? proposer : proposer.id === me.id ? other : me;
          const status = TRADE_STATUS_STYLES[entry.status];
          const current = entry.id === trade.id;
          const body = (
            <>
              <span className="flex min-w-0 flex-col">
                <span className="text-small font-medium text-tx wrap-anywhere">
                  Offer {index + 1} · by {by.id === me.id ? 'you' : by.displayName}
                  {current ? <span className="text-mut"> (this one)</span> : null}
                </span>
                <span className="font-mono text-[11.5px] text-faint">
                  {dateTime(entry.createdAt)}
                </span>
              </span>
              <Badge label={status.label} tone={status.tone} />
            </>
          );
          const box = 'flex items-center justify-between gap-3 rounded-control border px-3 py-2';
          return (
            <li key={entry.id}>
              {current ? (
                <div aria-current="page" className={cn(box, 'border-pri/40 bg-pri-dim')}>
                  {body}
                </div>
              ) : (
                <Link
                  href={`/trades/${entry.id}`}
                  className={cn(box, 'focus-ring border-bd bg-bg transition hover:bg-surface-2')}
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TradeDetailView({ trade }: { trade: TradeDetail }) {
  const queryClient = useQueryClient();
  const now = useMinute();
  const heading = useRef<HTMLHeadingElement>(null);
  const accept = useAcceptTrade();
  const decline = useDeclineTrade();
  const cancel = useCancelTrade();
  const [asking, setAsking] = useState<Action | null>(null);
  const answered = useRef(false);

  const incoming = trade.role === 'recipient';
  const me = incoming ? trade.recipient : trade.initiator;
  const other = incoming ? trade.initiator : trade.recipient;
  const name = other.displayName;
  const pending = trade.status === 'PENDING';
  const status = TRADE_STATUS_STYLES[trade.status];
  const atLimit = trade.chain.length >= MAX_COUNTER_CHAIN;
  const latest = trade.chain.at(-1);
  const replaced = latest !== undefined && latest.id !== trade.id;

  // The buttons go with the status once the answer lands; the heading takes the focus.
  useEffect(() => {
    if (answered.current && !pending) {
      answered.current = false;
      heading.current?.focus();
    }
  }, [pending]);

  const give = sideOf(trade, incoming ? 'REQUESTED' : 'OFFERED');
  const get = sideOf(trade, incoming ? 'OFFERED' : 'REQUESTED');
  const coinsGive = incoming ? trade.currencyFromRecipient : trade.currencyFromInitiator;
  const coinsGet = incoming ? trade.currencyFromInitiator : trade.currencyFromRecipient;

  const mutation = asking === 'accept' ? accept : asking === 'decline' ? decline : cancel;
  const DIALOG = {
    accept: {
      tone: 'success',
      icon: Check,
      title: `Accept ${name}’s trade?`,
      description: 'The cards and coins change hands at once; this cannot be undone.',
      confirm: 'Accept trade',
      done: `Traded with ${name}`,
    },
    decline: {
      tone: 'danger',
      icon: X,
      title: `Decline ${name}’s trade?`,
      description: `${name}’s offered cards are released back to them.`,
      confirm: 'Decline trade',
      done: `Declined ${name}’s offer`,
    },
    cancel: {
      tone: 'danger',
      icon: Ban,
      title: `Cancel your offer to ${name}?`,
      description: 'The offer closes and your offered cards are released back to you.',
      confirm: 'Cancel the offer',
      done: `Cancelled your offer to ${name}`,
    },
  } as const;
  const dialog = asking ? DIALOG[asking] : null;
  const summary = sides(trade);

  const confirm = () => {
    if (!asking) return;
    const done = DIALOG[asking].done;
    mutation.mutate(trade.id, {
      onSuccess: () => {
        answered.current = true;
        toastSuccess(done);
      },
      // Answered elsewhere meanwhile (409): show what it is now.
      onError: () => void queryClient.invalidateQueries({ queryKey: keys.trades.detail(trade.id) }),
      onSettled: () => setAsking(null),
    });
  };

  return (
    <>
      <Breadcrumbs
        trail={[{ label: 'Trades', href: '/trades' }, { label: `Trade with ${name}` }]}
        className="mb-4"
      />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <header className="flex flex-wrap items-center gap-4">
            <Avatar name={name} src={other.avatarUrl} size={48} decorative />
            <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
              <h1
                ref={heading}
                tabIndex={-1}
                className="text-h1 font-bold tracking-tight wrap-anywhere outline-none"
              >
                Trade with{' '}
                <Link
                  href={`/profile/${other.id}`}
                  className="focus-ring rounded-tag text-pri hover:underline"
                >
                  {name}
                </Link>
              </h1>
              <p className="text-body text-mut wrap-anywhere">
                {incoming ? `${name} proposed it` : 'You proposed it'} {timeAgo(trade.createdAt)} ·{' '}
                {statusLine(trade, name)}
              </p>
            </div>
            <div className="flex items-center gap-3">
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
            </div>
          </header>

          {replaced && latest ? (
            <p className="flex flex-wrap items-center gap-2 rounded-control border border-bd bg-surface px-4 py-3 text-small text-mut">
              <Info aria-hidden className="size-4 shrink-0" />
              This offer was answered with a counter-offer.
              <Link
                href={`/trades/${latest.id}`}
                className="focus-ring rounded-tag text-pri hover:underline"
              >
                Open the latest offer
              </Link>
            </p>
          ) : null}

          <TradeOfferPanel
            give={{ label: `You give ${name}`, cards: give, coins: coinsGive }}
            get={{ label: `${name} gives you`, cards: get, coins: coinsGet }}
          />

          {pending && incoming ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-3">
                <Button variant="confirm" icon={Check} onClick={() => setAsking('accept')}>
                  Accept trade
                </Button>
                {atLimit ? null : (
                  <Button asChild variant="secondary" icon={Repeat}>
                    <Link href={`/trades/new?counter=${trade.id}`}>Counter</Link>
                  </Button>
                )}
                <Button variant="ghost" icon={X} onClick={() => setAsking('decline')}>
                  Decline
                </Button>
              </div>
              {atLimit ? (
                <p className="text-small text-mut">
                  This negotiation has reached {MAX_COUNTER_CHAIN} offers, the most there can be:
                  accept or decline this one.
                </p>
              ) : null}
            </div>
          ) : null}
          {pending && !incoming ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" icon={Ban} onClick={() => setAsking('cancel')}>
                Cancel offer
              </Button>
              <p className="text-small text-mut">
                Your offered cards stay locked until {name} answers or you cancel.
              </p>
            </div>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-6 rounded-card border border-bd bg-surface p-4.5">
          <section aria-labelledby="status-heading" className="flex flex-col gap-3">
            <h2 id="status-heading" className="text-small font-semibold text-mut">
              Status
            </h2>
            <TradeStatusTimeline steps={tradeTimelineSteps(trade)} />
          </section>
          {trade.chain.length > 1 ? <Negotiation trade={trade} me={me} other={other} /> : null}
        </aside>
      </div>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
        tone={dialog?.tone}
        icon={dialog?.icon}
        title={dialog?.title ?? ''}
        description={dialog?.description}
        confirmLabel={dialog?.confirm}
        cancelLabel={asking === 'cancel' ? 'Keep the offer' : undefined}
        confirming={mutation.isPending}
        onConfirm={confirm}
      >
        <dl className="flex flex-col gap-2 rounded-control border border-bd bg-bg p-3 text-small">
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-mut">You give</dt>
            <dd className="min-w-0 text-tx wrap-anywhere">{summary.give}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-mut">You get</dt>
            <dd className="min-w-0 text-tx wrap-anywhere">{summary.get}</dd>
          </div>
        </dl>
      </Dialog>
    </>
  );
}

export function TradeDetailPage({
  id,
  initial,
  initialAt,
}: {
  id: string;
  initial: TradeDetail;
  initialAt: number;
}) {
  const trade = useTrade(id, initial, initialAt);
  if (trade.error instanceof ApiError && trade.error.statusCode === 404) notFound();
  if (trade.data === undefined) {
    return trade.isError ? (
      <ListError error={trade.error} onRetry={() => void trade.refetch()} />
    ) : (
      <Skeleton shape="block" height="24rem" />
    );
  }
  return <TradeDetailView trade={trade.data} />;
}
