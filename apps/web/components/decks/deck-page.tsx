'use client';

import type { DeckDetail } from '@pokedrop/shared';
import { useQueryClient } from '@tanstack/react-query';
import { notFound } from 'next/navigation';
import { useEffect } from 'react';
import { ListError } from '@/components/list-states';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/core';
import { useDeck } from '@/lib/query/decks';
import { keys } from '@/lib/query/keys';
import { useSession } from '@/lib/session/context';
import { DeckBuilder } from './builder/deck-builder';
import { PublicDeck } from './public-deck';

export function DeckPageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the deck" className="flex flex-col gap-4">
      <Skeleton shape="block" height="3.5rem" />
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((slot) => (
          <Skeleton key={slot} shape="block" height="24rem" />
        ))}
      </div>
    </div>
  );
}

export function DeckPage({
  id,
  initial,
  initialAt,
}: {
  id: string;
  initial: DeckDetail;
  initialAt: number;
}) {
  const session = useSession();
  const deck = useDeck(id, initial, initialAt);
  const queryClient = useQueryClient();

  // A cached copy younger than the stale time beats initialData even when the server just read
  // a newer one (another tab saved): the newer server copy wins.
  useEffect(() => {
    const key = keys.decks.detail(id);
    const cached = queryClient.getQueryData<DeckDetail>(key);
    if (cached && initial.updatedAt.getTime() > cached.updatedAt.getTime()) {
      queryClient.setQueryData(key, initial, { updatedAt: initialAt });
    }
  }, [queryClient, id, initial, initialAt]);

  // Deleted, or made private, while open: the next refetch answers 404.
  if (deck.error instanceof ApiError && deck.error.statusCode === 404) notFound();
  if (deck.data === undefined) {
    return deck.isError ? (
      <ListError error={deck.error} onRetry={() => void deck.refetch()} />
    ) : (
      <DeckPageSkeleton />
    );
  }
  return deck.data.userId === session?.id ? (
    <DeckBuilder deck={deck.data} />
  ) : (
    <PublicDeck deck={deck.data} />
  );
}
