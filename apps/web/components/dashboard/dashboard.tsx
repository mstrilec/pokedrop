'use client';

import type { PackHistoryEntry, TradeView } from '@pokedrop/shared';
import {
  ArrowLeftRight,
  ArrowRight,
  Coins,
  DollarSign,
  Layers,
  type LucideIcon,
  Package,
  PackageOpen,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatUsd } from '@/components/cards/card-data';
import { sides, useMinute } from '@/components/trades/trade-summary';
import { CompletionMeter } from '@/components/ui/completion-meter';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { TRADE_STATUS_STYLES } from '@/lib/design/status';
import { formatCoins, timeAgo } from '@/lib/format';
import { useInventorySummary } from '@/lib/query/inventory';
import { useMe, useProgress } from '@/lib/query/me';
import { usePackHistory, usePackTemplates } from '@/lib/query/packs';
import { useTradeCount, useTrades } from '@/lib/query/trades';
import { OnboardingChecklist } from './onboarding-checklist';

const FEATURED = 3;
const ACTIVITY = 6;
const SETS = 4;

function Widget({
  id,
  title,
  link,
  children,
}: {
  id: string;
  title: string;
  link?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex min-w-0 flex-col gap-4 rounded-card border border-bd bg-surface p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-h3">
          {title}
        </h2>
        {link ? (
          <Link
            href={link.href}
            className="focus-ring shrink-0 rounded-tag text-small text-pri hover:underline"
          >
            {link.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function FeaturedPacks() {
  const templates = usePackTemplates();
  const featured = templates.data?.slice(0, FEATURED) ?? [];
  return (
    <Widget id="featured" title="Featured packs" link={{ href: '/packs', label: 'All packs' }}>
      {templates.isPending ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: FEATURED }, (_, i) => (
            <Skeleton key={i} shape="block" height="5.5rem" />
          ))}
        </div>
      ) : featured.length === 0 ? (
        <EmptyState
          icon={Package}
          tone="neutral"
          title="No packs on sale right now"
          body="New packs appear here as soon as they’re released."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-3">
          {featured.map((template) => (
            <li key={template.id}>
              <Link
                href="/packs"
                className="focus-ring flex h-full flex-col gap-2 rounded-control border border-bd bg-bg p-4 transition hover:-translate-y-0.5 hover:border-pri"
              >
                <PackageOpen aria-hidden className="size-6 text-pri" />
                <span className="font-semibold text-tx">{template.name}</span>
                <span className="flex items-center gap-1 font-mono text-small text-gold">
                  <Coins aria-hidden className="size-3.5" />
                  {formatCoins(template.cost)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

type Activity = {
  id: string;
  at: Date;
  icon: LucideIcon;
  text: string;
  detail: string;
  href: string;
};

function packActivity(entry: PackHistoryEntry): Activity {
  const best = [...entry.cards].sort(
    (a, b) => (b.card.latestPriceUsd ?? 0) - (a.card.latestPriceUsd ?? 0),
  )[0];
  return {
    id: `pack-${entry.openingId}`,
    at: entry.createdAt,
    icon: PackageOpen,
    text: `Opened ${entry.templateName}`,
    detail: `${entry.cards.length} cards${best ? ` · best pull ${best.card.name}` : ''}`,
    href: `/packs/history#opening-${entry.openingId}`,
  };
}

function tradeActivity(trade: TradeView): Activity {
  const other = trade.role === 'recipient' ? trade.initiator : trade.recipient;
  const { give, get } = sides(trade);
  return {
    id: `trade-${trade.id}`,
    // A closed trade happened when it closed.
    at: trade.resolvedAt ?? trade.createdAt,
    icon: ArrowLeftRight,
    text: `Trade with ${other.displayName} · ${TRADE_STATUS_STYLES[trade.status].label}`,
    detail: `You give ${give} · you get ${get}`,
    href: `/trades/${trade.id}`,
  };
}

function RecentActivity() {
  const packs = usePackHistory();
  const trades = useTrades('all');
  const loading = packs.isPending || trades.isPending;
  const items = [
    ...(packs.data?.pages[0]?.items.map(packActivity) ?? []),
    ...(trades.data?.pages[0]?.items.map(tradeActivity) ?? []),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, ACTIVITY);

  return (
    <Widget id="activity" title="Recent activity">
      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} shape="block" height="3.25rem" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Nothing here yet"
          body="Packs you open and trades you make show up here."
          cta={{ label: 'Open a pack', href: '/packs', icon: PackageOpen }}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="focus-ring flex items-center gap-3 rounded-control px-2 py-2 transition hover:bg-surface-2"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-surface-2 text-pri">
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-small font-medium text-tx">{item.text}</span>
                    <span className="truncate text-[11.5px] text-mut">{item.detail}</span>
                  </span>
                  <time
                    dateTime={item.at.toISOString()}
                    className="shrink-0 text-[11.5px] text-faint"
                  >
                    {timeAgo(item.at)}
                  </time>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Widget>
  );
}

function SetProgress() {
  const summary = useInventorySummary();
  // The sets furthest along, as a share of the set.
  const sets = (summary.data?.setCompletion ?? [])
    .filter((set) => set.owned > 0 && set.total > 0)
    .sort((a, b) => b.owned / b.total - a.owned / a.total || b.owned - a.owned)
    .slice(0, SETS);

  return (
    <Widget id="sets" title="Set completion" link={{ href: '/sets', label: 'All sets' }}>
      {summary.isPending ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: SETS }, (_, i) => (
            <Skeleton key={i} shape="block" height="2.5rem" />
          ))}
        </div>
      ) : sets.length === 0 ? (
        <EmptyState
          icon={Layers}
          tone="accent"
          title="No sets started"
          body="Every card you pull counts toward its set."
          cta={{ label: 'Browse sets', href: '/sets', icon: ArrowRight }}
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {sets.map((set) => (
            <li key={set.setId}>
              <CompletionMeter label={set.name} value={set.owned} max={set.total} />
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

function Stats() {
  const me = useMe();
  const summary = useInventorySummary();
  const loading = summary.isPending;
  const s = summary.data;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard
        label="Total cards"
        value={s ? s.totalCards.toLocaleString('en-US') : '—'}
        icon={Layers}
        tone="primary"
        loading={loading}
      />
      <StatCard
        label="Different cards"
        value={s ? s.uniqueCards.toLocaleString('en-US') : '—'}
        icon={Sparkles}
        tone="accent"
        loading={loading}
      />
      <StatCard
        label="Collection value"
        value={s ? formatUsd(s.collectionValueUsd) : '—'}
        icon={DollarSign}
        tone="success"
        loading={loading}
      />
      <StatCard
        label="Balance"
        value={me.data ? formatCoins(me.data.currency) : '—'}
        icon={Coins}
        tone="warning"
        loading={me.isPending}
      />
    </div>
  );
}

export function Dashboard() {
  const me = useMe();
  const progress = useProgress();
  const incoming = useTradeCount('incoming');
  const name = me.data?.displayName;
  // 0 on the server: the date is the reader's own, so it renders in the browser.
  const now = useMinute();
  const today = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-h1 font-bold tracking-tight wrap-anywhere">
            {name
              ? `Welcome${progress.data?.openedPack === false ? '' : ' back'}, ${name}`
              : 'Welcome'}
          </h1>
          <p className="text-body text-mut">
            {incoming.data ? (
              <Link href="/trades?tab=incoming" className="text-pri hover:underline">
                {incoming.data} {incoming.data === 1 ? 'trade is' : 'trades are'} waiting on you
              </Link>
            ) : (
              'No trades waiting on you'
            )}
            .
          </p>
        </div>
        {now > 0 ? <p className="font-mono text-small text-faint">{today.format(now)}</p> : null}
      </header>

      {/* No skeleton: most visits end with no checklist, and a placeholder that then vanishes
          would shift the page up for every collector past onboarding. */}
      {progress.data ? <OnboardingChecklist progress={progress.data} /> : null}

      <Stats />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <FeaturedPacks />
          <RecentActivity />
        </div>
        <SetProgress />
      </div>
    </div>
  );
}
