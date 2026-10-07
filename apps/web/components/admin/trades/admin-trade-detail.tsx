'use client';

import type { TradeDetail } from '@pokedrop/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ScrollText, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { cardView } from '@/components/cards/card-data';
import { TradeOfferPanel } from '@/components/trades/trade-offer-panel';
import { TradeStatusTimeline, tradeTimelineSteps } from '@/components/trades/trade-status-timeline';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { TRADE_STATUS_STYLES } from '@/lib/design/status';
import { dateTime } from '@/lib/format';
import { useAdminTrade } from '@/lib/query/admin';
import { keys } from '@/lib/query/keys';
import { VoidDialog } from './void-dialog';

const side = (trade: TradeDetail, which: 'OFFERED' | 'REQUESTED') =>
  trade.items
    .filter((item) => item.side === which)
    .map((item) => ({
      card: cardView(item.card),
      count: item.quantity,
      locked: which === 'OFFERED' && trade.status === 'PENDING',
    }));

// Admin links: the timeline's and the chain's `/trades/…` become `/admin/trades/…`.
const adminHref = (href: string) => href.replace(/^\/trades\//, '/admin/trades/');

export function AdminTradeDetail({
  id,
  initial,
  initialAt,
}: {
  id: string;
  initial: TradeDetail;
  initialAt: number;
}) {
  const queryClient = useQueryClient();
  const trade = useAdminTrade(id, initial, initialAt).data ?? initial;
  const [voiding, setVoiding] = useState(false);
  const status = TRADE_STATUS_STYLES[trade.status];
  const a = trade.initiator;
  const b = trade.recipient;
  const steps = tradeTimelineSteps(trade).map((step) =>
    step.link ? { ...step, link: { ...step.link, href: adminHref(step.link.href) } } : step,
  );
  const voidable = trade.status === 'PENDING' || trade.status === 'ACCEPTED';
  const userLink = (party: { displayName: string }) =>
    `/admin/users?q=${encodeURIComponent(party.displayName)}`;

  return (
    <>
      <Breadcrumbs
        trail={[
          { label: 'Trade moderation', href: '/admin/trades' },
          { label: `${a.displayName} → ${b.displayName}` },
        ]}
        className="mb-4"
      />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <header className="flex flex-wrap items-center gap-3">
            <h1 className="flex min-w-0 flex-wrap items-center gap-2 text-h1 font-bold tracking-tight wrap-anywhere">
              <Link href={userLink(a)} className="focus-ring rounded-tag hover:underline">
                {a.displayName}
              </Link>
              <ArrowRight aria-label="to" className="size-6 text-faint" />
              <Link href={userLink(b)} className="focus-ring rounded-tag hover:underline">
                {b.displayName}
              </Link>
            </h1>
            <Badge label={status.label} tone={status.tone} />
          </header>
          <p className="text-small text-mut">
            Created {dateTime(trade.createdAt)}
            {trade.resolvedAt ? ` · closed ${dateTime(trade.resolvedAt)}` : ''} ·{' '}
            <span className="font-mono">{trade.id}</span>
          </p>
          <TradeOfferPanel
            give={{
              label: `${a.displayName} gives`,
              cards: side(trade, 'OFFERED'),
              coins: trade.currencyFromInitiator,
            }}
            get={{
              label: `${b.displayName} gives`,
              cards: side(trade, 'REQUESTED'),
              coins: trade.currencyFromRecipient,
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            {voidable ? (
              <Button variant="destructive" icon={ShieldAlert} onClick={() => setVoiding(true)}>
                Void trade
              </Button>
            ) : (
              <p className="text-small text-mut">
                A {status.label.toLowerCase()} trade has nothing to void.
              </p>
            )}
            <Button asChild variant="ghost" icon={ScrollText}>
              <Link href={`/admin/audit?entity=Trade&entityId=${encodeURIComponent(trade.id)}`}>
                View in the audit log
              </Link>
            </Button>
          </div>
        </div>
        <aside className="flex min-w-0 flex-col gap-6 rounded-card border border-bd bg-surface p-4.5">
          <section aria-labelledby="status-heading" className="flex flex-col gap-3">
            <h2 id="status-heading" className="text-small font-semibold text-mut">
              Status
            </h2>
            <TradeStatusTimeline steps={steps} />
          </section>
          {trade.chain.length > 1 ? (
            <section aria-labelledby="chain-heading" className="flex flex-col gap-2">
              <h2 id="chain-heading" className="text-small font-semibold text-mut">
                Negotiation · {trade.chain.length} offers
              </h2>
              <ol className="flex flex-col gap-2">
                {trade.chain.map((entry, index) => (
                  <li key={entry.id}>
                    {entry.id === trade.id ? (
                      <span
                        aria-current="page"
                        className="flex justify-between gap-2 rounded-control border border-pri/40 bg-pri-dim px-3 py-2 text-small"
                      >
                        Offer {index + 1} (this one){' '}
                        <Badge
                          label={TRADE_STATUS_STYLES[entry.status].label}
                          tone={TRADE_STATUS_STYLES[entry.status].tone}
                        />
                      </span>
                    ) : (
                      <Link
                        href={`/admin/trades/${entry.id}`}
                        className="focus-ring flex justify-between gap-2 rounded-control border border-bd bg-bg px-3 py-2 text-small hover:bg-surface-2"
                      >
                        Offer {index + 1}{' '}
                        <Badge
                          label={TRADE_STATUS_STYLES[entry.status].label}
                          tone={TRADE_STATUS_STYLES[entry.status].tone}
                        />
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </aside>
      </div>
      {voiding ? (
        <VoidDialog
          trade={trade}
          open
          onClose={() => setVoiding(false)}
          onSettled={() =>
            void queryClient.invalidateQueries({ queryKey: keys.admin.trade(trade.id) })
          }
        />
      ) : null}
    </>
  );
}
