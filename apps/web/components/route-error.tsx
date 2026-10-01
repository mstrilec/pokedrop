'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/core';

export type RouteErrorProps = { error: Error & { digest?: string }; retry: () => void };

// A server render's error reaches the browser stripped to its digest, which
// the server log prints beside the ApiError and its request id. An error
// thrown in the browser arrives whole, with its own request id.
export function RouteError({ error, retry }: RouteErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const reference = (error instanceof ApiError ? error.requestId : undefined) ?? error.digest;

  return (
    <section
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
    >
      <h1 className="text-h2">Something went wrong</h1>
      <p className="text-mut">This part of PokéDrop could not load. The rest still works.</p>
      {reference ? <p className="font-mono text-small text-faint">Reference {reference}</p> : null}
      <Button onClick={retry}>Try again</Button>
    </section>
  );
}
