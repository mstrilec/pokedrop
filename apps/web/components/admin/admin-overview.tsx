'use client';

import type { AdminMetrics, MetricsDay, MetricsWindow } from '@pokedrop/shared';
import {
  ArrowLeftRight,
  Flag,
  Gift,
  PackageOpen,
  RefreshCw,
  ServerCrash,
  Users,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ListError } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { Tabs, TabsPanel, useUrlTab } from '@/components/ui/tabs';
import { dateTime, timeAgo } from '@/lib/format';
import { useAdminMetrics } from '@/lib/query/admin';
import { cn } from '@/lib/utils';
import type { ChartMetric } from './metrics-chart';

const MetricsChart = dynamic(() => import('./metrics-chart').then((m) => m.MetricsChart), {
  ssr: false,
  loading: () => <Skeleton shape="block" height="100%" />,
});

const WINDOWS = ['14', '7', '30'] as const;
const CHART: { key: ChartMetric; label: string }[] = [
  { key: 'packsOpened', label: 'Packs opened' },
  { key: 'activeUsers', label: 'Active users' },
  { key: 'tradesAccepted', label: 'Trades settled' },
  { key: 'tradesProposed', label: 'Trades proposed' },
];
const CHART_KEYS = ['packsOpened', 'activeUsers', 'tradesAccepted', 'tradesProposed'] as const;

/** `+12% on Oct 4` against the day before; `—` with nothing to compare. */
function trendOf(current: number | null, previous: number | null, day: string) {
  if (current === null || previous === null) return { trend: undefined, tone: 'flat' as const };
  if (previous === 0) {
    return current === 0
      ? { trend: `Same as ${day}`, tone: 'flat' as const }
      : { trend: `Up from 0 on ${day}`, tone: 'up' as const };
  }
  const change = Math.round(((current - previous) / previous) * 100);
  return {
    trend: `${change > 0 ? '+' : ''}${change}% on ${day}`,
    tone: change > 0 ? ('up' as const) : change < 0 ? ('down' as const) : ('flat' as const),
  };
}

const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
const percent = (rate: number | null) => (rate === null ? '—' : `${(rate * 100).toFixed(2)}%`);

function Summary({ metrics }: { metrics: AdminMetrics }) {
  const s = metrics.summary;
  if (!s) {
    return <Unavailable what="Daily figures" why="the activity tables could not be read" />;
  }
  const before = shortDay(s.previous.day);
  const card = (
    label: string,
    pick: (day: MetricsDay) => number | null,
    icon: typeof Users,
    tone: 'primary' | 'success' | 'warning' | 'danger' | 'accent',
    format: (value: number | null) => string = (v) =>
      v === null ? '—' : v.toLocaleString('en-US'),
  ) => {
    const { trend, tone: trendTone } = trendOf(pick(s.current), pick(s.previous), before);
    return (
      <StatCard
        label={label}
        value={format(pick(s.current))}
        icon={icon}
        tone={tone}
        trend={trend}
        trendTone={trendTone}
      />
    );
  };
  return (
    <section aria-labelledby="yesterday-heading" className="flex flex-col gap-3">
      <h2 id="yesterday-heading" className="text-small font-semibold text-mut">
        Yesterday, {shortDay(s.current.day)} (UTC) — the last complete day
      </h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {card('Active users', (d) => d.activeUsers, Users, 'primary')}
        {card('Packs opened', (d) => d.packsOpened, PackageOpen, 'warning')}
        {card('Trades settled', (d) => d.tradesAccepted, ArrowLeftRight, 'success')}
        {card('Server error rate', (d) => d.errorRate, ServerCrash, 'danger', percent)}
      </div>
    </section>
  );
}

function Unavailable({ what, why }: { what: string; why: string }) {
  return (
    <p className="rounded-control border border-gold/30 bg-gold-dim px-4 py-3 text-small text-gold">
      {what} unavailable: {why}.
    </p>
  );
}

function Panel({
  id,
  title,
  children,
  action,
}: {
  id: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex min-w-0 flex-col gap-4 rounded-card border border-bd bg-surface p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-h3">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Trend({ metrics }: { metrics: AdminMetrics }) {
  const [metric, setMetric] = useUrlTab('chart', CHART_KEYS);
  const label = CHART.find((c) => c.key === metric)?.label ?? '';
  const series = metrics.series;
  return (
    <Panel
      id="trend"
      title={`${label} · last ${metrics.window.days} days`}
      action={
        <div role="group" aria-label="Chart shows" className="flex flex-wrap gap-1">
          {CHART.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={metric === c.key}
              onClick={() => setMetric(c.key)}
              className={cn(
                'focus-ring cursor-pointer rounded-pill border px-3 py-1 text-small transition',
                metric === c.key
                  ? 'border-pri bg-pri-dim text-pri'
                  : 'border-bd-2 text-mut hover:text-tx',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      }
    >
      {series ? (
        <>
          <div aria-hidden className="h-56">
            <MetricsChart series={series} metric={metric} />
          </div>
          <table className="sr-only">
            <caption>
              {label} per UTC day, {metrics.window.from} to {metrics.window.to}; today is still
              counting
            </caption>
            <tbody>
              {series.map((day) => (
                <tr key={day.day}>
                  <th scope="row">{day.day}</th>
                  <td>{day[metric]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11.5px] text-faint">
            UTC days; today’s bar, faded, is still counting.
          </p>
        </>
      ) : (
        <Unavailable what="The chart" why="the activity tables could not be read" />
      )}
    </Panel>
  );
}

function Freshness({ metrics }: { metrics: AdminMetrics }) {
  const f = metrics.freshness;
  return (
    <Panel
      id="freshness"
      title="Catalog and prices"
      action={
        <Link
          href="/admin/sync"
          className="focus-ring rounded-tag text-small text-pri hover:underline"
        >
          Sync control
        </Link>
      }
    >
      {!f ? (
        <Unavailable what="Freshness" why="the catalog could not be read" />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4 text-small">
            <div>
              <dt className="text-mut">Oldest price</dt>
              <dd className="text-tx">
                {f.oldestPriceUpdatedAt ? (
                  <time
                    dateTime={f.oldestPriceUpdatedAt.toISOString()}
                    title={dateTime(f.oldestPriceUpdatedAt)}
                  >
                    updated {timeAgo(f.oldestPriceUpdatedAt)}
                  </time>
                ) : (
                  'No prices yet'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-mut">Cards without a price</dt>
              <dd className="font-mono text-tx">{f.cardsWithoutPrice.toLocaleString('en-US')}</dd>
            </div>
          </dl>
          {f.lastRuns === null ? (
            <Unavailable what="Last runs" why="the sync status could not be read" />
          ) : f.lastRuns.length === 0 ? (
            <p className="text-small text-mut">No sync has run yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {f.lastRuns.map((run) => (
                <li
                  key={`${run.kind}-${run.startedAt.toISOString()}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-bd bg-bg px-3 py-2 text-small"
                >
                  <span className="font-medium text-tx">{run.kind.toLowerCase()} sync</span>
                  <Badge
                    label={run.stale ? 'Stalled' : run.status.toLowerCase()}
                    tone={
                      run.stale || run.status === 'FAILED'
                        ? 'danger'
                        : run.status === 'RUNNING'
                          ? 'warning'
                          : 'success'
                    }
                    shape="tag"
                  />
                  <span className="text-mut">
                    {run.provider} · {run.processed.toLocaleString('en-US')} processed
                    {run.failed > 0 ? `, ${run.failed} failed` : ''} · started{' '}
                    {timeAgo(run.startedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

function Queues({ metrics }: { metrics: AdminMetrics }) {
  const queues = metrics.queues;
  return (
    <Panel id="queues" title="Queues">
      {queues === null ? (
        <Unavailable what="Queue depth" why="Redis could not be read" />
      ) : queues.length === 0 ? (
        <p className="text-small text-mut">No queues registered.</p>
      ) : (
        <table className="w-full text-left text-small">
          <thead className="text-mut">
            <tr>
              <th scope="col" className="pb-2 font-medium">
                Queue
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Waiting
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Active
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Delayed
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Failed
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bd font-mono">
            {queues.map((q) => (
              <tr key={q.queue}>
                <th scope="row" className="py-2 font-sans font-normal text-tx">
                  {q.queue}
                </th>
                <td className="py-2 text-right">{q.waiting}</td>
                <td className="py-2 text-right">{q.active}</td>
                <td className="py-2 text-right">{q.delayed}</td>
                <td className={cn('py-2 text-right', q.failed > 0 && 'text-red')}>{q.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

export function AdminOverview() {
  const [days, setDays] = useUrlTab('days', WINDOWS);
  const metrics = useAdminMetrics(Number(days) as MetricsWindow);
  const data = metrics.data;

  return (
    <>
      <PageHeader
        title="Operations overview"
        description={
          data ? (
            <>
              Figures computed{' '}
              <time dateTime={data.generatedAt.toISOString()} title={dateTime(data.generatedAt)}>
                {timeAgo(data.generatedAt)}
              </time>
              ; they refresh at most once a minute.
            </>
          ) : (
            'Platform health at a glance.'
          )
        }
        actions={
          <>
            <Button asChild variant="secondary" size="sm" icon={Gift}>
              <Link href="/admin/users">Grant currency</Link>
            </Button>
            <Button asChild variant="secondary" size="sm" icon={RefreshCw}>
              <Link href="/admin/sync">Run a sync</Link>
            </Button>
            <Button asChild variant="secondary" size="sm" icon={Flag}>
              <Link href="/admin/trades">Review trades</Link>
            </Button>
          </>
        }
      />
      <Tabs
        label="Window"
        value={days}
        onValueChange={setDays}
        tabs={[
          { value: '7', label: '7 days' },
          { value: '14', label: '14 days' },
          { value: '30', label: '30 days' },
        ]}
      >
        <TabsPanel value={days}>
          {data ? (
            <div className={cn('flex flex-col gap-6', metrics.isPlaceholderData && 'opacity-60')}>
              <Summary metrics={data} />
              <Trend metrics={data} />
              <div className="grid gap-6 lg:grid-cols-2">
                <Freshness metrics={data} />
                <Queues metrics={data} />
              </div>
            </div>
          ) : metrics.isError ? (
            <ListError error={metrics.error} onRetry={() => void metrics.refetch()} />
          ) : (
            <div aria-busy="true" aria-label="Loading the figures" className="flex flex-col gap-6">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <StatCard key={i} label="…" value="" loading />
                ))}
              </div>
              <Skeleton shape="block" height="18rem" />
              <div className="grid gap-6 lg:grid-cols-2">
                <Skeleton shape="block" height="12rem" />
                <Skeleton shape="block" height="12rem" />
              </div>
            </div>
          )}
        </TabsPanel>
      </Tabs>
    </>
  );
}
