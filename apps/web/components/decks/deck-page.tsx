'use client';

import type { DeckDetail } from '@pokedrop/shared';
import { notFound } from 'next/navigation';
import { ListError } from '@/components/list-states';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/core';
import { useDeck } from '@/lib/query/decks';
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
  const deck = useDeck(id, initial);

  if (deck.isPending) return <DeckPageSkeleton />;
  if (deck.isError) {
    // Deleted, or made private, while open: the next refetch answers 404.
    if (deck.error instanceof ApiError && deck.error.statusCode === 404) notFound();
    return <ListError error={deck.error} onRetry={() => void deck.refetch()} />;
  }
  return <PublicDeck deck={deck.data} />;
}
