'use client';

import { Button } from '@/components/ui/button';

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1>Something went wrong</h1>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
