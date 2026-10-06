import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ProfilePage } from '@/components/profile/profile-page';
import { ApiError } from '@/lib/api/core';
import { publicProfile, userDecks } from '@/lib/api/endpoints/users';
import { serverApi } from '@/lib/api/server';

// The public shape only, for every visitor alike: what the owner alone sees is read in their
// browser (`OwnProfile`), never here.
const loadProfile = cache(async (id: string) => {
  try {
    return await serverApi.call(publicProfile(id));
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) return null;
    throw error;
  }
});

export async function generateMetadata({ params }: PageProps<'/profile/[id]'>): Promise<Metadata> {
  const { id } = await params;
  const profile = await loadProfile(id).catch(() => null);
  if (!profile) return { title: 'Collector not found' };
  const showcased = profile.showcase.map((card) => card.name);
  const description = [
    `${profile.displayName} collects Pokémon cards on PokéDrop.`,
    showcased.length > 0 ? `Showcase: ${showcased.join(', ')}.` : null,
    `${profile.publicDeckCount} public ${profile.publicDeckCount === 1 ? 'deck' : 'decks'}.`,
  ]
    .filter(Boolean)
    .join(' ');
  const url = `/profile/${encodeURIComponent(profile.id)}`;
  // Without a showcase the group's own `opengraph-image` stands.
  const first = profile.showcase[0];
  const images = first
    ? [{ url: first.imageSmall, alt: `${first.name}, on ${profile.displayName}’s showcase` }]
    : undefined;
  return {
    title: profile.displayName,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'profile',
      siteName: 'PokéDrop',
      url,
      title: profile.displayName,
      description,
      ...(images ? { images } : {}),
    },
    twitter: {
      card: 'summary',
      title: profile.displayName,
      description,
      ...(images ? { images: images.map((i) => i.url) } : {}),
    },
  };
}

export default async function Page({ params }: PageProps<'/profile/[id]'>) {
  const { id } = await params;
  const profile = await loadProfile(id);
  if (!profile) notFound();
  const decks = await serverApi.call(userDecks(profile.id)).catch(() => null);
  return <ProfilePage profile={profile} decks={decks} />;
}
