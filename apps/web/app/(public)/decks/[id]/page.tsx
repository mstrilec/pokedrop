import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { DeckPage } from '@/components/decks/deck-page';
import { ApiError } from '@/lib/api/core';
import { deck } from '@/lib/api/endpoints/decks';
import { serverApi } from '@/lib/api/server';

// With the visitor's cookies: the API answers a private deck to its owner only, so a stranger's
// private deck is the same 404 as one that never existed. One request for the page and its title.
const loadDeck = cache(async (id: string) => {
  try {
    return await serverApi.call(deck(id));
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) return null;
    throw error;
  }
});

export async function generateMetadata({ params }: PageProps<'/decks/[id]'>): Promise<Metadata> {
  const { id } = await params;
  const found = await loadDeck(id).catch(() => null);
  return { title: found?.name ?? 'Deck' };
}

export default async function Page({ params }: PageProps<'/decks/[id]'>) {
  const { id } = await params;
  const found = await loadDeck(id);
  if (!found) notFound();
  return <DeckPage id={id} initial={found} />;
}
