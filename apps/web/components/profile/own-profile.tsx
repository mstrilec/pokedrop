'use client';

import { ArrowLeftRight, Coins, Eye, EyeOff, Layers, Lock } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatUsd } from '@/components/cards/card-data';
import { formatLabel } from '@/components/decks/deck-format';
import { sides } from '@/components/trades/trade-summary';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TRADE_STATUS_STYLES } from '@/lib/design/status';
import { formatCoins, timeAgo } from '@/lib/format';
import { useMyDecks } from '@/lib/query/decks';
import { useInventorySummary } from '@/lib/query/inventory';
import { useMe } from '@/lib/query/me';
import { useTrades } from '@/lib/query/trades';
import { useSession } from '@/lib/session/context';

const RECENT_TRADES = 5;

function Panel({
  title,
  href,
  link,
  children,
}: {
  title: string;
  href: string;
  link: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-card border border-bd bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-h3">{title}</h3>
        <Link
          href={href}
          className="focus-ring shrink-0 rounded-tag text-small text-pri hover:underline"
        >
          {link}
        </Link>
      </div>
      {children}
    </section>
  );
}

function Visibility({ shown, label }: { shown: boolean; label: string }) {
  const Icon = shown ? Eye : EyeOff;
  return (
    <li className="flex items-center gap-2 text-small">
      <Icon aria-hidden className={shown ? 'size-4 text-grn' : 'size-4 text-faint'} />
      <span className="text-tx">{label}</span>
      <span className="text-mut">— {shown ? 'shown to visitors' : 'hidden from visitors'}</span>
    </li>
  );
}

function Sections() {
  const me = useMe();
  const summary = useInventorySummary();
  const trades = useTrades('all');
  const decks = useMyDecks();
  const recent = trades.data?.pages[0]?.items.slice(0, RECENT_TRADES) ?? [];
  const privateDecks = (decks.data?.pages.flatMap((page) => page.items) ?? []).filter(
    (deck) => !deck.isPublic,
  );

  return (
    <section aria-labelledby="private-heading" className="flex flex-col gap-4">
      <h2 id="private-heading" className="flex items-center gap-2 text-h2">
        <Lock aria-hidden className="size-5 text-gold" />
        Only you see this
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Balance and collection" href="/wallet" link="Wallet">
          {me.data && summary.data ? (
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-small text-mut">Balance</dt>
                <dd className="flex items-center gap-1.5 font-mono text-h3 text-gold">
                  <Coins aria-hidden className="size-4" />
                  {formatCoins(me.data.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-small text-mut">Collection value</dt>
                <dd className="font-mono text-h3 text-tx">
                  {formatUsd(summary.data.collectionValueUsd)}
                </dd>
              </div>
              <div>
                <dt className="text-small text-mut">Cards</dt>
                <dd className="font-mono text-tx">
                  {summary.data.totalCards.toLocaleString('en-US')} ·{' '}
                  {summary.data.uniqueCards.toLocaleString('en-US')} different
                </dd>
              </div>
            </dl>
          ) : (
            <Skeleton shape="block" height="5rem" />
          )}
          {me.data ? (
            <ul className="flex flex-col gap-1.5 border-t border-bd pt-3">
              <Visibility shown={me.data.privacy.showCollectionValue} label="Collection value" />
              <Visibility shown={me.data.privacy.showSetCompletion} label="Set completion" />
              <li className="text-small">
                <Link href="/settings" className="focus-ring rounded-tag text-pri hover:underline">
                  Change what visitors see
                </Link>
              </li>
            </ul>
          ) : null}
        </Panel>

        <Panel title="Recent trades" href="/trades?tab=all" link="All trades">
          {trades.isPending ? (
            <Skeleton shape="block" height="5rem" />
          ) : recent.length === 0 ? (
            <p className="text-small text-mut">No trades yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {recent.map((trade) => {
                const other = trade.role === 'recipient' ? trade.initiator : trade.recipient;
                const status = TRADE_STATUS_STYLES[trade.status];
                const { give, get } = sides(trade);
                return (
                  <li key={trade.id}>
                    <Link
                      href={`/trades/${trade.id}`}
                      className="focus-ring flex items-center gap-3 rounded-control border border-bd bg-bg px-3 py-2 transition hover:bg-surface-2"
                    >
                      <ArrowLeftRight aria-hidden className="size-4 shrink-0 text-faint" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-small font-medium text-tx">
                          {other.displayName}
                        </span>
                        <span className="truncate text-[11.5px] text-mut">
                          You give {give} · you get {get} · {timeAgo(trade.createdAt)}
                        </span>
                      </span>
                      <Badge label={status.label} tone={status.tone} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Private decks" href="/decks" link="All decks">
          {decks.isPending ? (
            <Skeleton shape="block" height="4rem" />
          ) : privateDecks.length === 0 ? (
            <p className="text-small text-mut">Every deck you have is public.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {privateDecks.map((deck) => (
                <li key={deck.id}>
                  <Link
                    href={`/decks/${deck.id}`}
                    className="focus-ring flex items-center gap-3 rounded-control border border-bd bg-bg px-3 py-2 transition hover:bg-surface-2"
                  >
                    <Layers aria-hidden className="size-4 shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate text-small font-medium text-tx">
                      {deck.name}
                    </span>
                    <span className="shrink-0 font-mono text-[11.5px] text-faint">
                      {deck.cardCount} cards · {formatLabel(deck.format)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  );
}

/**
 * The owner's private sections, only when the viewer is the owner, and read from the owner's
 * own endpoints (`/users/me`, `/inventory/summary`, `/trades`, `/decks`) in the browser: anyone
 * else's page, server HTML or client, holds none of it.
 */
export function OwnProfile({ userId }: { userId: string }) {
  const session = useSession();
  return session?.id === userId ? <Sections /> : null;
}
