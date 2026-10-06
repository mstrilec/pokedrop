import type { DeckPage, PublicProfile } from '@pokedrop/shared';
import { DollarSign, Globe, Layers, Sparkles, Star } from 'lucide-react';
import Link from 'next/link';
import { cardView, formatUsd } from '@/components/cards/card-data';
import { CardTile } from '@/components/cards/card-tile';
import { formatLabel } from '@/components/decks/deck-format';
import { Avatar } from '@/components/ui/avatar';
import { CompletionMeter } from '@/components/ui/completion-meter';
import { StatCard } from '@/components/ui/stat-card';
import { OwnProfile } from './own-profile';
import { ProfileActions } from './profile-actions';

const HIGHLIGHT_SETS = 4;

export function joinedText(joinedAt: Date): string {
  return joinedAt.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The public profile: the same for every visitor; the owner's extras come from `OwnProfile`. */
export function ProfilePage({
  profile,
  decks,
}: {
  profile: PublicProfile;
  decks: DeckPage | null;
}) {
  const { collection, completion } = profile;
  // The sets furthest along, as a share of the set.
  const highlights = completion
    ? [...completion.setCompletion]
        .filter((set) => set.total > 0)
        .sort((a, b) => b.owned / b.total - a.owned / a.total || b.owned - a.owned)
        .slice(0, HIGHLIGHT_SETS)
    : [];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-center gap-5 rounded-card border border-bd bg-surface p-6">
        <Avatar name={profile.displayName} src={profile.avatarUrl} size={80} decorative />
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
          <h1 className="text-h1 font-bold tracking-tight wrap-anywhere">{profile.displayName}</h1>
          <p className="text-body text-mut">
            Joined{' '}
            <time dateTime={profile.joinedAt.toISOString()}>{joinedText(profile.joinedAt)}</time> ·
            Collector on PokéDrop
          </p>
        </div>
        <ProfileActions userId={profile.id} name={profile.displayName} />
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Showcased cards"
          value={String(profile.showcase.length)}
          icon={Star}
          tone="warning"
        />
        <StatCard
          label="Public decks"
          value={String(profile.publicDeckCount)}
          icon={Layers}
          tone="primary"
        />
        {collection ? (
          <StatCard
            label="Collection value"
            value={formatUsd(collection.collectionValueUsd)}
            icon={DollarSign}
            tone="success"
          />
        ) : null}
        {completion ? (
          <StatCard
            label="Different cards"
            value={completion.uniqueCards.toLocaleString('en-US')}
            icon={Sparkles}
            tone="accent"
          />
        ) : null}
      </div>

      <section aria-labelledby="showcase-heading" className="flex flex-col gap-4">
        <h2 id="showcase-heading" className="text-h2">
          Showcase
        </h2>
        {profile.showcase.length === 0 ? (
          <p className="text-body text-mut wrap-anywhere">
            {profile.displayName} hasn’t picked any cards to show yet.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] sm:gap-4">
            {profile.showcase.map((card) => (
              <li key={card.id}>
                <CardTile card={cardView(card)} sizes="(min-width: 640px) 180px, 40vw" />
              </li>
            ))}
          </ul>
        )}
      </section>

      {highlights.length > 0 ? (
        <section aria-labelledby="sets-heading" className="flex flex-col gap-4">
          <h2 id="sets-heading" className="text-h2">
            Set completion
          </h2>
          <ul className="grid gap-4 md:grid-cols-2">
            {highlights.map((set) => (
              <li key={set.setId} className="rounded-card border border-bd bg-surface p-4">
                <CompletionMeter label={set.name} value={set.owned} max={set.total} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="decks-heading" className="flex flex-col gap-4">
        <h2 id="decks-heading" className="text-h2">
          Public decks
        </h2>
        {!decks || decks.items.length === 0 ? (
          <p className="text-body text-mut">No public decks yet.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {decks.items.map((deck) => (
              <li key={deck.id}>
                <Link
                  href={`/decks/${deck.id}`}
                  className="focus-ring flex items-center gap-3 rounded-card border border-bd bg-surface p-4 transition hover:bg-surface-2"
                >
                  <Globe aria-hidden className="size-4 shrink-0 text-pri" />
                  <span className="min-w-0 flex-1 truncate font-medium text-tx">{deck.name}</span>
                  <span className="shrink-0 font-mono text-small text-faint">
                    {deck.cardCount} cards · {formatLabel(deck.format)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {decks && decks.total > decks.items.length ? (
          <p className="text-small text-mut">
            Showing the newest {decks.items.length} of {decks.total}.
          </p>
        ) : null}
      </section>

      <OwnProfile userId={profile.id} />
    </div>
  );
}
