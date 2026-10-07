'use client';

import { AUDIT_ACTION_GROUPS, AUDIT_ENTITIES, type AuditEntry } from '@pokedrop/shared';
import { ScrollText, X } from 'lucide-react';
import Link from 'next/link';
import { z } from 'zod';
import { ListError, LoadMore } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { dateTime, timeAgo } from '@/lib/format';
import { useAuditLog } from '@/lib/query/admin';
import { useUrlState } from '@/lib/url-state';
import { UserFilter } from '../user-filter';
import { actionWords, entityHref, entityLabel, KNOWN_ACTIONS, metaSummary } from './audit-words';

const GROUP_LABELS: Record<(typeof AUDIT_ACTION_GROUPS)[number], string> = {
  trade: 'Trades',
  user: 'Users',
  pack_template: 'Pack templates',
  sync: 'Sync',
};

const Day = z.iso.date().optional().catch(undefined);
const FiltersSchema = z.object({
  actor: z.string().min(1).max(64).optional().catch(undefined),
  action: z
    .string()
    .regex(/^[a-z_]+(\.[a-z_]+)?$/)
    .optional()
    .catch(undefined),
  entity: z.enum(AUDIT_ENTITIES).optional().catch(undefined),
  entityId: z.string().min(1).max(128).optional().catch(undefined),
  from: Day,
  to: Day,
});

function actorLabel(items: AuditEntry[], actor: string | undefined) {
  if (actor === undefined) return undefined;
  if (actor === 'system') return 'System';
  const row = items.find((entry) => entry.actor?.id === actor);
  return row?.actor ? row.actor.displayName || row.actor.email : undefined;
}

function Row({ entry }: { entry: AuditEntry }) {
  const summary = metaSummary(entry);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
      <time
        dateTime={entry.createdAt.toISOString()}
        title={dateTime(entry.createdAt)}
        className="text-[11.5px] text-faint"
      >
        {timeAgo(entry.createdAt)}
      </time>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-small">
          {entry.actor ? (
            <b className="font-semibold text-tx wrap-anywhere">
              {entry.actor.displayName || entry.actor.email}
            </b>
          ) : (
            <b className="font-semibold text-mut">System</b>
          )}
          <span className="text-tx">{actionWords(entry.action).toLowerCase()}</span>
          <Link
            href={entityHref(entry)}
            className="focus-ring min-w-0 rounded-tag text-pri wrap-anywhere hover:underline"
          >
            {entityLabel(entry)}
          </Link>
          <span className="font-mono text-[11px] text-faint">{entry.action}</span>
        </p>
        {summary ? <p className="text-small text-mut wrap-anywhere">{summary}</p> : null}
        <details>
          <summary className="focus-ring cursor-pointer rounded-tag text-[11.5px] text-mut">
            Details
          </summary>
          <pre className="mt-1 overflow-x-auto rounded-control bg-bg p-2 font-mono text-[11px] text-mut">
            {JSON.stringify(
              {
                actor: entry.actor?.email ?? 'system',
                entity: entry.entity,
                entityId: entry.entityId,
                meta: entry.meta,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </div>
    </li>
  );
}

const CLEARED = {
  actor: undefined,
  action: undefined,
  entity: undefined,
  entityId: undefined,
  from: undefined,
  to: undefined,
};

/** The log, newest first. Read-only: no control here changes or removes an entry. */
export function AdminAudit() {
  const [filters, setFilters] = useUrlState(FiltersSchema);
  const range =
    filters.from && filters.to && filters.from > filters.to
      ? {}
      : { from: filters.from, to: filters.to };
  const log = useAuditLog({
    actor: filters.actor,
    action: filters.action,
    entity: filters.entity,
    entityId: filters.entity ? filters.entityId : undefined,
    ...range,
  });
  const items = log.data?.pages.flatMap((page) => page.items) ?? [];
  const total = log.data?.pages[0]?.total ?? 0;
  const filtered = Object.values(filters).some((value) => value !== undefined);
  const select = 'focus-ring h-10 rounded-control border border-bd-2 bg-bg px-3 text-small text-tx';

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every recorded action, newest first. Read-only: nothing here changes or removes an entry."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <UserFilter
          label="Who"
          value={filters.actor}
          valueLabel={actorLabel(items, filters.actor)}
          extra={{ value: 'system', label: 'System' }}
          onChange={(actor) => setFilters({ actor })}
        />
        <label className="flex flex-col gap-1.5 text-small text-mut">
          Action
          <select
            className={select}
            value={filters.action ?? ''}
            onChange={(event) => setFilters({ action: event.target.value || undefined })}
          >
            <option value="">Any action</option>
            {AUDIT_ACTION_GROUPS.map((group) => (
              <option key={group} value={group}>
                {GROUP_LABELS[group]} — all
              </option>
            ))}
            {KNOWN_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {actionWords(action)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-small text-mut">
          Object
          <select
            className={select}
            value={filters.entity ?? ''}
            onChange={(event) =>
              setFilters({ entity: event.target.value || undefined, entityId: undefined })
            }
          >
            <option value="">Any object</option>
            {AUDIT_ENTITIES.map((entity) => (
              <option key={entity} value={entity}>
                {entity}
              </option>
            ))}
          </select>
        </label>
        {filters.entity && filters.entityId ? (
          <span className="flex h-10 items-center gap-1 rounded-pill border border-bd-2 bg-surface-2 py-1 pr-1 pl-3 text-small text-tx">
            <span className="max-w-52 truncate font-mono text-[11.5px]">{filters.entityId}</span>
            <button
              type="button"
              aria-label="Clear the object"
              onClick={() => setFilters({ entityId: undefined })}
              className="focus-ring flex size-6 cursor-pointer items-center justify-center rounded-pill text-mut hover:text-tx"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        ) : null}
        <Input
          label="From"
          type="date"
          value={filters.from ?? ''}
          onChange={(event) => setFilters({ from: event.target.value })}
          className="w-40"
        />
        <Input
          label="To"
          type="date"
          value={filters.to ?? ''}
          onChange={(event) => setFilters({ to: event.target.value })}
          className="w-40"
        />
      </div>
      {log.isPending ? (
        <div aria-busy="true" aria-label="Loading the audit log" className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((slot) => (
            <Skeleton key={slot} shape="block" height="3.5rem" />
          ))}
        </div>
      ) : log.isError ? (
        <ListError error={log.error} onRetry={() => void log.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          tone="neutral"
          title="No entries match"
          body="Widen the dates or clear a filter."
          cta={
            filtered ? { label: 'Clear filters', onClick: () => setFilters(CLEARED) } : undefined
          }
        />
      ) : (
        <>
          <ol
            aria-label="Audit entries, newest first"
            className="flex flex-col divide-y divide-bd rounded-card border border-bd bg-surface"
          >
            {items.map((entry) => (
              <Row key={entry.id} entry={entry} />
            ))}
          </ol>
          <LoadMore
            shown={items.length}
            total={total}
            noun={total === 1 ? 'entry' : 'entries'}
            hasMore={log.hasNextPage}
            loading={log.isFetchingNextPage}
            onLoad={() => void log.fetchNextPage()}
          />
        </>
      )}
    </>
  );
}
