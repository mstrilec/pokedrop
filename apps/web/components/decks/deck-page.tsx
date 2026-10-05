'use client';

import type { DeckDetail } from '@pokedrop/shared';
import { notFound } from 'next/navigation';
import { ListError } from '@/components/list-states';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/core';
import { useDeck } from '@/lib/query/decks';
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

export function DeckPage({ id, initial }: { id: string; initial: DeckDetail }) {
  const session = useSession();
  const deck = useDeck(id, initial);

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
