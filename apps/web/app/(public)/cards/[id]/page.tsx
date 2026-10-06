import type { Card } from '@pokedrop/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache, Suspense } from 'react';
import { formatUsd } from '@/components/cards/card-data';
import { CardDetail, cardNumber } from '@/components/cards/detail/card-detail';
import { CardSpecies } from '@/components/cards/detail/card-species';
import { ApiError } from '@/lib/api/core';
import { card, priceHistory, set } from '@/lib/api/endpoints/catalog';
import { serverApi } from '@/lib/api/server';

// No loading.tsx above this page: the 404 for an unknown card must be decided before anything
// streams, or the status is already 200 (docs/Pages.md, Card detail).
const loadCard = cache(async (id: string) => {
  try {
    return await serverApi.call(card(id));
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) return null;
    throw error;
  }
});

// The set and the price history are extras: the page renders without either.
const loadSet = cache((setId: string) => serverApi.call(set(setId)).catch(() => null));

const loadPage = cache(async (id: string) => {
  const found = await loadCard(id);
  if (!found) return null;
  const [cardSet, history] = await Promise.all([
    loadSet(found.setId),
    serverApi.call(priceHistory(id)).catch(() => null),
  ]);
  return { card: found, set: cardSet, history, now: new Date() };
});

// The segment arrives still percent-encoded (`ex10-%3F`); the API call encodes it again.
async function cardIdOf(params: PageProps<'/cards/[id]'>['params']): Promise<string> {
  const { id } = await params;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

function describe(found: Card, setName: string | null, printed: string): string {
  const kind = [found.rarity, found.types.join('/'), found.supertype].filter(Boolean).join(' ');
  const parts = [
    `${found.name}${setName ? ` from ${setName} (${printed})` : ''}: ${kind}${found.hp !== null ? `, HP ${found.hp}` : ''}.`,
    found.latestPriceUsd !== null ? `Market price ${formatUsd(found.latestPriceUsd)}.` : null,
    'Attacks, set details and 30-day price history on PokéDrop.',
  ];
  return parts.filter(Boolean).join(' ');
}

export async function generateMetadata({ params }: PageProps<'/cards/[id]'>): Promise<Metadata> {
  const id = await cardIdOf(params);
  const found = await loadCard(id).catch(() => null);
  if (!found) return { title: 'Card not found' };
  const cardSet = await loadSet(found.setId);
  const printed = cardSet
    ? `${cardNumber(found.id)}/${cardSet.printedTotal}`
    : cardNumber(found.id);
  const title = cardSet ? `${found.name} · ${cardSet.name} ${printed}` : found.name;
  const description = describe(found, cardSet?.name ?? null, printed);
  const url = `/cards/${encodeURIComponent(found.id)}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: 'PokéDrop',
      url,
      title,
      description,
      images: [{ url: found.imageLarge, alt: `${found.name} card art` }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [found.imageLarge] },
  };
}

export default async function Page({ params }: PageProps<'/cards/[id]'>) {
  const id = await cardIdOf(params);
  const page = await loadPage(id);
  if (!page) notFound();
  const dex = page.card.nationalPokedexNumbers[0];

  return (
    <CardDetail
      card={page.card}
      set={page.set}
      history={page.history}
      now={page.now}
      species={
        dex !== undefined ? (
          <Suspense fallback={null}>
            <CardSpecies dex={dex} />
          </Suspense>
        ) : null
      }
    />
  );
}
