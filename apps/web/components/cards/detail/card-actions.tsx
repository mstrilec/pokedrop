'use client';

import { ArrowLeftRight, Layers, Lock, LogIn, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { NewDeckDialog } from '@/components/decks/decks-list';
import { formatLabel } from '@/components/decks/deck-format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyDecks } from '@/lib/query/decks';
import { useOwnedCounts } from '@/lib/query/inventory';
import { signInUrl } from '@/lib/routes';
import { useSession } from '@/lib/session/context';

type Prompt = 'deck' | 'trade' | null;

/** `Owned: 3 · 1 locked` once the counts answer; nothing signed out (D1). */
function OwnedBadge({ cardId }: { cardId: string }) {
  const { owned, known } = useOwnedCounts([[cardId]], true);
  if (!known.has(cardId)) return <Skeleton width="7rem" />;
  const mine = owned.get(cardId);
  if (!mine || mine.quantity === 0) {
    return <p className="text-small text-mut">Not in your collection</p>;
  }
  const locked = mine.quantity - mine.available;
  return (
    <p className="flex items-center gap-1.5 text-small text-tx">
      <Layers aria-hidden className="size-4 text-pri" />
      Owned: <b className="font-mono">{mine.quantity}</b>
      {locked > 0 ? (
        <span className="flex items-center gap-1 text-gold">
          · <Lock aria-hidden className="size-3.5" />
          {locked} locked in trades
        </span>
      ) : null}
    </p>
  );
}

function DeckPicker({
  cardId,
  cardName,
  onNew,
}: {
  cardId: string;
  cardName: string;
  onNew: () => void;
}) {
  const router = useRouter();
  const decks = useMyDecks();
  const items = decks.data?.pages.flatMap((page) => page.items) ?? [];
  const open = (deckId: string) =>
    router.push(`/decks/${deckId}?add=${encodeURIComponent(cardId)}`);

  return (
    <div className="flex flex-col gap-3">
      {decks.isPending ? (
        <Skeleton shape="block" height="6rem" />
      ) : items.length === 0 ? (
        <p className="text-small text-mut">You have no decks yet.</p>
      ) : (
        <ul aria-label="Your decks" className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {items.map((deck) => (
            <li key={deck.id}>
              <button
                type="button"
                onClick={() => open(deck.id)}
                aria-label={`Add ${cardName} to ${deck.name}`}
                className="focus-ring flex w-full cursor-pointer items-center justify-between gap-3 rounded-control border border-bd bg-bg px-3 py-2 text-left transition hover:bg-surface-2"
              >
                <span className="min-w-0 truncate text-small font-medium text-tx">{deck.name}</span>
                <span className="shrink-0 font-mono text-[11.5px] text-faint">
                  {deck.cardCount} cards · {formatLabel(deck.format)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {decks.hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          loading={decks.isFetchingNextPage}
          onClick={() => void decks.fetchNextPage()}
        >
          More decks
        </Button>
      ) : null}
      <Button variant="secondary" icon={Plus} onClick={onNew}>
        New deck with {cardName}
      </Button>
    </div>
  );
}

export function CardActions({ cardId, cardName }: { cardId: string; cardName: string }) {
  const session = useSession();
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const here = `/cards/${encodeURIComponent(cardId)}`;
  const tradeHref = `/trades/new?card=${encodeURIComponent(cardId)}`;

  return (
    <div className="flex flex-col gap-3">
      {session ? <OwnedBadge cardId={cardId} /> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          icon={Plus}
          onClick={() => (session ? setPicking(true) : setPrompt('deck'))}
        >
          Add to deck
        </Button>
        {session ? (
          <Button asChild icon={ArrowLeftRight}>
            <Link href={tradeHref}>Propose trade</Link>
          </Button>
        ) : (
          <Button icon={ArrowLeftRight} onClick={() => setPrompt('trade')}>
            Propose trade
          </Button>
        )}
      </div>

      <Dialog
        open={prompt !== null}
        onOpenChange={(open) => {
          if (!open) setPrompt(null);
        }}
        icon={LogIn}
        title={
          prompt === 'deck'
            ? `Sign in to add ${cardName} to a deck`
            : `Sign in to trade for ${cardName}`
        }
        description="Decks and trades belong to your account. It’s free, and you start with coins for your first packs."
      >
        <div className="flex flex-col gap-2.5">
          <Button asChild>
            <Link href={signInUrl(prompt === 'trade' ? tradeHref : here)}>Sign in</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/register">Create an account</Link>
          </Button>
        </div>
      </Dialog>

      {session ? (
        <>
          <Dialog
            open={picking}
            onOpenChange={setPicking}
            icon={Layers}
            title={`Add ${cardName} to a deck`}
            description="The deck opens with one more copy added; save it there to keep it."
          >
            {picking ? (
              <DeckPicker
                cardId={cardId}
                cardName={cardName}
                onNew={() => {
                  setPicking(false);
                  setCreating(true);
                }}
              />
            ) : null}
          </Dialog>
          <NewDeckDialog open={creating} onClose={() => setCreating(false)} addCardId={cardId} />
        </>
      ) : null}
    </div>
  );
}
