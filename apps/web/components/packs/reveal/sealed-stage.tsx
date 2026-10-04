'use client';

import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/core';
import { apiErrorMessage } from '@/lib/toast';
import { PackArt } from './pack-art';

type Failure = { message: string; action: 'retry' | 'wallet' | 'packs' };

function failureOf(error: unknown): Failure {
  if (error instanceof ApiError && error.statusCode === 402) {
    return { message: 'You don’t have enough coins for this pack.', action: 'wallet' };
  }
  if (error instanceof ApiError && (error.statusCode === 404 || error.statusCode === 409)) {
    return { message: apiErrorMessage(error), action: 'packs' };
  }
  return { message: apiErrorMessage(error), action: 'retry' };
}

export function SealedStage({
  name,
  error,
  onOpen,
}: {
  name: string;
  error: unknown;
  onOpen: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  const failure = error ? failureOf(error) : null;

  return (
    <div className="flex flex-col items-center gap-11">
      <div
        aria-hidden
        onClick={failure && failure.action !== 'retry' ? undefined : onOpen}
        className="relative animate-float-pack cursor-pointer"
      >
        <span className="absolute -inset-17.5 animate-pulse-glow rounded-pill bg-pri/40 blur-2xl" />
        <PackArt name={name} />
      </div>
      {failure ? (
        <div role="alert" className="flex max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-body text-red">{failure.message}</p>
          {failure.action === 'wallet' ? (
            <Button asChild variant="secondary">
              <Link href="/wallet">Go to wallet</Link>
            </Button>
          ) : failure.action === 'packs' ? (
            <Button asChild variant="secondary">
              <Link href="/packs">Back to packs</Link>
            </Button>
          ) : (
            <Button ref={button} size="lg" icon={Sparkles} onClick={onOpen}>
              Try again
            </Button>
          )}
        </div>
      ) : (
        <Button ref={button} size="lg" icon={Sparkles} onClick={onOpen}>
          Tap to open
        </Button>
      )}
    </div>
  );
}
