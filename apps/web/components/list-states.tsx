'use client';

import { CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/core';
import { apiErrorMessage } from '@/lib/toast';

const count = new Intl.NumberFormat('en-US');

/** The foot of a cursor-paged list: how much is shown, and the next page on demand. */
export function LoadMore({
  shown,
  total,
  noun,
  hasMore,
  loading,
  onLoad,
}: {
  shown: number;
  total: number;
  noun: string;
  hasMore: boolean;
  loading: boolean;
  onLoad: () => void;
}) {
  return (
    <div className="mt-6 flex flex-col items-center gap-3">
      <p role="status" className="text-small text-mut">
        Showing {count.format(shown)} of {count.format(total)} {noun}
      </p>
      {hasMore ? (
        <Button variant="secondary" loading={loading} onClick={onLoad}>
          Show more
        </Button>
      ) : null}
    </div>
  );
}

/** A query that failed where its list should be: what happened and a way to try again. */
export function ListError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <section
      role="alert"
      className="flex flex-col items-center gap-3 rounded-card border border-red/30 bg-red-dim px-7 py-10 text-center"
    >
      <CircleAlert aria-hidden className="size-6 text-red" />
      <p className="text-body text-tx">{apiErrorMessage(error)}</p>
      {requestId ? (
        <p className="font-mono text-caption text-faint">Request ID {requestId}</p>
      ) : null}
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </section>
  );
}
