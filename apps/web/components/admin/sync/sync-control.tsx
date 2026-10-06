'use client';

import type { SyncRunSummary, SyncStatusResponse, SyncTriggerKind } from '@pokedrop/shared';
import { Play, RotateCcw, ShieldAlert } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { ListError } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/core';
import { dateTime, timeAgo } from '@/lib/format';
import { syncBusy, useResetBreaker, useSyncStatus, useTriggerSync } from '@/lib/query/admin';
import { apiErrorMessage, toastSuccess } from '@/lib/toast';

type Kind = SyncTriggerKind;

const JOBS: Record<
  Kind,
  { title: string; what: string; queue: string; run: SyncRunSummary['kind'] }
> = {
  CATALOG: {
    title: 'Catalog sync',
    what: 'Every set and card from the provider. Runs nightly at 03:00 UTC.',
    queue: 'catalog-sync',
    run: 'CATALOG',
  },
  PRICE: {
    title: 'Price sweep',
    what: 'The latest price of every card. Runs nightly at 04:00 UTC and takes about 15 minutes.',
    queue: 'price-sweep',
    run: 'PRICE',
  },
};

// A second's clock while something runs, for the elapsed time; nothing ticks otherwise.
function subscribeSeconds(notify: () => void) {
  const timer = setInterval(notify, 1_000);
  return () => clearInterval(timer);
}
const noSubscription = () => () => {};
function useSeconds(active: boolean): number {
  return useSyncExternalStore(
    active ? subscribeSeconds : noSubscription,
    () => Math.floor(Date.now() / 1_000) * 1_000,
    () => 0,
  );
}

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1_000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function runTone(run: SyncRunSummary): BadgeTone {
  if (run.stale) return 'danger';
  if (run.status === 'RUNNING') return 'warning';
  if (run.status === 'SUCCEEDED') return 'success';
  if (run.status === 'PARTIAL') return 'warning';
  return 'danger';
}

function RunLine({ run, now }: { run: SyncRunSummary; now: number }) {
  const running = run.status === 'RUNNING' && !run.stale;
  const elapsed = running && now > 0 ? now - run.startedAt.getTime() : run.durationMs;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-small">
        <Badge
          label={run.stale ? 'Stalled' : run.status.toLowerCase()}
          tone={runTone(run)}
          shape="tag"
        />
        <span className="text-mut">
          {run.provider} · started{' '}
          <time dateTime={run.startedAt.toISOString()} title={dateTime(run.startedAt)}>
            {timeAgo(run.startedAt)}
          </time>
          {elapsed !== null ? ` · ${running ? 'running for' : 'took'} ${duration(elapsed)}` : ''}
        </span>
      </div>
      <p className="font-mono text-small text-tx" aria-live={running ? 'polite' : undefined}>
        {run.processed.toLocaleString('en-US')} processed
        {run.failed > 0 ? (
          <span className="text-red"> · {run.failed.toLocaleString('en-US')} failed</span>
        ) : null}
      </p>
      {running ? (
        <div aria-hidden className="h-1.5 overflow-hidden rounded-pill bg-surface-2">
          <div className="h-full w-full animate-pulse rounded-pill bg-pri/70" />
        </div>
      ) : null}
      {run.stale ? (
        <p className="text-small text-red">
          Its job is gone; nothing will close this run. The next run replaces it.
        </p>
      ) : null}
      {run.error ? <p className="text-small break-words text-mut">{run.error}</p> : null}
    </div>
  );
}

function JobCard({
  kind,
  status,
  busy,
  queued,
  starting,
  refused,
  now,
  onRun,
}: {
  kind: Kind;
  status: SyncStatusResponse;
  busy: string | null;
  /** The job this page queued for this kind, until its run appears. */
  queued: string | null;
  starting: boolean;
  refused: string | null;
  now: number;
  onRun: () => void;
}) {
  const job = JOBS[kind];
  const run = status.runs?.find((r) => r.kind === job.run) ?? null;
  const depth = status.queues?.find((q) => q.queue === job.queue);
  const waiting = depth ? depth.waiting + depth.delayed : 0;

  return (
    <section
      aria-labelledby={`${kind}-heading`}
      className="flex min-w-0 flex-col gap-4 rounded-card border border-bd bg-surface p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${kind}-heading`} className="text-h3">
          {job.title}
        </h2>
        <p className="text-small text-mut">{job.what}</p>
      </div>
      {queued !== null || waiting > 0 ? (
        <p role="status" className="text-small text-gold">
          Queued — waiting for a worker to start it{queued ? ` (job ${queued.slice(0, 8)})` : ''}.
        </p>
      ) : null}
      {run ? (
        <RunLine run={run} now={now} />
      ) : status.runs === null ? (
        <p className="text-small text-mut">The last run couldn’t be read.</p>
      ) : (
        <p className="text-small text-mut">Never run.</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          icon={Play}
          loading={starting}
          disabled={busy !== null}
          aria-describedby={busy ? `${kind}-busy` : undefined}
          onClick={onRun}
        >
          Run now
        </Button>
        {busy ? (
          <p id={`${kind}-busy`} className="text-small text-mut">
            {busy}
          </p>
        ) : null}
      </div>
      {refused ? (
        <p role="alert" className="text-small text-red">
          {refused}
        </p>
      ) : null}
    </section>
  );
}

/** Why neither button may start a run now: the two share one daily budget and run one at a time. */
function busyReason(
  status: SyncStatusResponse,
  starting: boolean,
  queued: string | null,
): string | null {
  if (starting) return 'Starting…';
  const open = (status.runs ?? []).find(
    (run) =>
      run.status === 'RUNNING' && !run.stale && (run.kind === 'CATALOG' || run.kind === 'PRICE'),
  );
  if (open) {
    return `${open.kind === 'CATALOG' ? 'A catalog sync' : 'A price sweep'} is running; one run at a time.`;
  }
  if (syncBusy(status) || queued !== null) return 'A run is queued; one run at a time.';
  return null;
}

function Breakers({ status }: { status: SyncStatusResponse }) {
  const reset = useResetBreaker();
  const [asking, setAsking] = useState<string | null>(null);
  if (status.breakers === null) {
    return <p className="text-small text-gold">The breakers couldn’t be read (Redis).</p>;
  }
  if (status.breakers.length === 0)
    return <p className="text-small text-mut">No provider has failed lately.</p>;
  return (
    <>
      <ul className="flex flex-col gap-2">
        {status.breakers.map((breaker) => {
          const open = breaker.openUntil !== null;
          return (
            <li
              key={breaker.provider}
              className="flex flex-wrap items-center gap-3 rounded-control border border-bd bg-bg px-3 py-2 text-small"
            >
              <span className="font-medium text-tx">{breaker.provider}</span>
              <Badge
                label={open ? 'Open' : 'Closed'}
                tone={open ? 'danger' : 'success'}
                shape="tag"
              />
              <span className="text-mut">
                {breaker.failures} recent {breaker.failures === 1 ? 'failure' : 'failures'}
                {breaker.openUntil ? ` · retried after ${dateTime(breaker.openUntil)}` : ''}
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon={RotateCcw}
                className="ml-auto"
                disabled={breaker.failures === 0 && !open}
                onClick={() => setAsking(breaker.provider)}
              >
                Reset
              </Button>
            </li>
          );
        })}
      </ul>
      <Dialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
        tone="danger"
        icon={ShieldAlert}
        title={`Reset the ${asking ?? ''} breaker?`}
        description="Its failure count is cleared and the next run may use it at once. If the provider is still failing, the breaker opens again after five failures."
        confirmLabel="Reset breaker"
        confirming={reset.isPending}
        onConfirm={() =>
          asking &&
          reset.mutate(asking, {
            onSuccess: (state) => {
              toastSuccess(`${state.provider}: breaker reset`);
              setAsking(null);
            },
          })
        }
      />
    </>
  );
}

export function SyncControl() {
  const status = useSyncStatus();
  const trigger = useTriggerSync();
  const [refused, setRefused] = useState<{ kind: Kind; message: string } | null>(null);
  const data = status.data;
  const busy = data ? syncBusy(data) : false;
  const now = useSeconds(busy);
  // The job this page queued, until a run carrying its id shows up in the status.
  const sent = trigger.data;
  const queued =
    sent && data && !(data.runs ?? []).some((run) => run.jobId === sent.jobId) ? sent : null;

  const run = (kind: Kind) => {
    setRefused(null);
    trigger.mutate(kind, {
      onSuccess: (result) =>
        toastSuccess(`${JOBS[kind].title} queued (job ${result.jobId.slice(0, 8)})`),
      onError: (error) =>
        setRefused({
          kind,
          message:
            error instanceof ApiError && error.code === 'SYNC_IN_PROGRESS'
              ? `Not started: ${error.message}`
              : apiErrorMessage(error),
        }),
    });
  };

  return (
    <>
      <PageHeader
        title="Sync control"
        description={
          data ? (
            <>
              The next run uses <b className="text-tx">{data.nextProvider ?? 'no provider'}</b>
              {data.nextProvider === null
                ? ' — every provider’s breaker is open; reset one below.'
                : data.nextProvider === data.primaryProvider
                  ? ' (the primary).'
                  : `, because the primary (${data.primaryProvider}) has its breaker open.`}
            </>
          ) : (
            'Catalog and price syncs, the queues behind them and the providers they call.'
          )
        }
      />
      {data ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {(['CATALOG', 'PRICE'] as const).map((kind) => (
              <JobCard
                key={kind}
                kind={kind}
                status={data}
                busy={busyReason(data, trigger.isPending, queued?.jobId ?? null)}
                queued={queued?.kind === kind ? queued.jobId : null}
                starting={trigger.isPending && trigger.variables === kind}
                refused={refused?.kind === kind ? refused.message : null}
                now={now}
                onRun={() => run(kind)}
              />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <section
              aria-labelledby="active-heading"
              className="flex flex-col gap-3 rounded-card border border-bd bg-surface p-5"
            >
              <h2 id="active-heading" className="text-h3">
                Active-card prices
              </h2>
              <p className="text-small text-mut">
                Cards someone owns, has in a deck or traded lately, four times a day. It has no
                button.
              </p>
              {data.runs?.find((r) => r.kind === 'PRICE_ACTIVE') ? (
                <RunLine run={data.runs.find((r) => r.kind === 'PRICE_ACTIVE')!} now={now} />
              ) : (
                <p className="text-small text-mut">Never run.</p>
              )}
            </section>
            <section
              aria-labelledby="breakers-heading"
              className="flex flex-col gap-3 rounded-card border border-bd bg-surface p-5"
            >
              <h2 id="breakers-heading" className="text-h3">
                Providers
              </h2>
              <Breakers status={data} />
            </section>
          </div>
          <section
            aria-labelledby="queues-heading"
            className="flex flex-col gap-3 rounded-card border border-bd bg-surface p-5"
          >
            <h2 id="queues-heading" className="text-h3">
              Queues
            </h2>
            {data.queues === null ? (
              <p className="text-small text-gold">Queue depth couldn’t be read (Redis).</p>
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
                  {data.queues.map((q) => (
                    <tr key={q.queue}>
                      <th scope="row" className="py-2 font-sans font-normal text-tx">
                        {q.queue}
                      </th>
                      <td className="py-2 text-right">{q.waiting}</td>
                      <td className="py-2 text-right">{q.active}</td>
                      <td className="py-2 text-right">{q.delayed}</td>
                      <td className={q.failed > 0 ? 'py-2 text-right text-red' : 'py-2 text-right'}>
                        {q.failed}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      ) : status.isError ? (
        <ListError error={status.error} onRetry={() => void status.refetch()} />
      ) : (
        <div
          aria-busy="true"
          aria-label="Loading the sync status"
          className="grid gap-6 lg:grid-cols-2"
        >
          <Skeleton shape="block" height="14rem" />
          <Skeleton shape="block" height="14rem" />
        </div>
      )}
    </>
  );
}
