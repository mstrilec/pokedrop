'use client';

import type { DeckDetail } from '@pokedrop/shared';
import { Copy, LogIn } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cardView } from '@/components/cards/card-data';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useCloneDeck } from '@/lib/query/decks';
import { useSession } from '@/lib/session/context';
import { formatLabel } from './deck-format';
import { groupBySupertype } from './deck-groups';
import { DeckSlot } from './deck-slot';

export function PublicDeck({ deck }: { deck: DeckDetail }) {
  const session = useSession();
  const router = useRouter();
  const clone = useCloneDeck();
  const total = deck.cards.reduce((sum, entry) => sum + entry.count, 0);
  const groups = groupBySupertype(deck.cards, (entry) => entry.card);

  return (
    <>
      <PageHeader
        title={deck.name}
        description={
          <>
            {formatLabel(deck.format)} · {total} {total === 1 ? 'card' : 'cards'} · by{' '}
            <Link
              href={`/profile/${deck.userId}`}
              className="focus-ring rounded-tag text-pri hover:underline"
            >
              {deck.ownerDisplayName}
            </Link>
          </>
        }
        actions={
          session ? (
            <Button
              icon={Copy}
              loading={clone.isPending}
              onClick={() =>
                clone.mutate(deck.id, { onSuccess: (copy) => router.push(`/decks/${copy.id}`) })
              }
            >
              Clone
            </Button>
          ) : (
            <Button asChild variant="secondary" icon={LogIn}>
              <Link href={`/sign-in?next=${encodeURIComponent(`/decks/${deck.id}`)}`}>
                Sign in to clone
              </Link>
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Decklist" className="flex flex-col gap-5">
          {groups.length === 0 ? <p className="text-body text-mut">This deck is empty.</p> : null}
          {groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-2">
              <h2 className="flex items-center justify-between text-small font-semibold text-mut">
                {group.label}
                <span className="font-mono">{group.total}</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {group.entries.map((entry) => (
                  <li key={entry.cardId}>
                    <DeckSlot card={cardView(entry.card)} count={entry.count} readOnly />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
