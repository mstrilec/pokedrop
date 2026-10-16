'use client';

import { type InventoryCard, type MyProfile, SHOWCASE_MAX_CARDS } from '@pokedrop/shared';
import { Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { CardArt } from '@/components/cards/card-art';
import { cardView } from '@/components/cards/card-data';
import { VirtualCardGrid } from '@/components/collection/virtual-card-grid';
import { PickTile } from '@/components/trades/composer/card-picker-dialog';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { SearchInput } from '@/components/ui/search-input';
import { useUpdateMe } from '@/lib/query/account';
import { useInventory } from '@/lib/query/inventory';
import { toastApiError, toastSuccess } from '@/lib/toast';
import { SettingsSection } from './settings-section';

function Status({ children }: { children: string }) {
  return <p className="py-8 text-center text-small text-mut">{children}</p>;
}

// Mounted only while the dialog is open, so the collection is not read until then.
function ShowcasePicker({
  refusal,
  onPick,
}: {
  refusal: (cardId: string) => string | null;
  onPick: (card: InventoryCard) => void;
}) {
  const [q, setQ] = useState('');
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const list = useInventory({ q: q || undefined });
  const entries = list.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <SearchInput
        value={q}
        onSearch={setQ}
        label="Search your cards"
        placeholder="Search by name…"
        maxLength={100}
      />
      <div ref={setScroller} className="overflow-y-auto pr-1" style={{ height: '55dvh' }}>
        {list.isPending ? (
          <Status>Loading your cards…</Status>
        ) : entries.length === 0 ? (
          <Status>{q ? 'No cards of yours match' : 'You have no cards yet'}</Status>
        ) : (
          <VirtualCardGrid
            items={entries}
            getKey={(entry) => entry.id}
            label="Your cards"
            minTileWidth={110}
            hasMore={list.hasNextPage}
            loadingMore={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
            scrollElement={scroller}
            renderTile={(entry) => (
              <PickTile
                card={entry.card}
                refusal={refusal(entry.card.id)}
                onPick={() => onPick(entry.card)}
              />
            )}
          />
        )}
      </div>
    </>
  );
}

/** Every change saves at once, like the privacy toggles. */
export function ShowcaseSettings({ me }: { me: MyProfile }) {
  const update = useUpdateMe();
  const [open, setOpen] = useState(false);
  const ids: string[] = me.showcase.map((card) => card.id);
  const full = ids.length >= SHOWCASE_MAX_CARDS;

  const save = (next: string[], done: string) =>
    update.mutate(
      { showcaseCardIds: next },
      { onSuccess: () => toastSuccess(done), onError: toastApiError },
    );

  const refusal = (cardId: string) =>
    ids.includes(cardId)
      ? 'Already on your showcase'
      : full
        ? `Your showcase holds ${SHOWCASE_MAX_CARDS} cards`
        : null;

  return (
    <SettingsSection
      id="showcase"
      title="Showcase"
      description={
        <>
          Up to {SHOWCASE_MAX_CARDS} of your cards, on{' '}
          <Link href={`/profile/${me.id}`} className="text-pri hover:underline">
            your public profile
          </Link>{' '}
          and first in line when someone picks what to ask you for in a trade. The rest of your
          collection stays private.
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {me.showcase.length === 0 ? (
          <p className="text-small text-mut">
            No cards yet. Traders only see your collection through what you show here.
          </p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-3">
            {me.showcase.map((card) => (
              <li key={card.id} className="flex flex-col gap-1.5">
                <span className="relative block aspect-[5/7] overflow-hidden rounded-tile border border-bd">
                  <CardArt card={cardView(card)} sizes="110px" />
                </span>
                <span className="truncate text-small font-semibold">{card.name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={X}
                  disabled={update.isPending}
                  aria-label={`Remove ${card.name} from your showcase`}
                  onClick={() =>
                    save(
                      ids.filter((id) => id !== card.id),
                      `${card.name} is off your showcase`,
                    )
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            icon={Plus}
            disabled={full || update.isPending}
            onClick={() => setOpen(true)}
          >
            Add a card
          </Button>
          <span className="font-mono text-small text-mut">
            {ids.length} / {SHOWCASE_MAX_CARDS}
          </span>
        </div>
      </div>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Add to your showcase"
        description={`Pick from your cards; up to ${SHOWCASE_MAX_CARDS} in all.`}
        className="max-w-180"
      >
        <div className="flex flex-col gap-4">
          <ShowcasePicker
            refusal={(cardId) => (update.isPending ? 'Saving…' : refusal(cardId))}
            onPick={(card) => save([...ids, card.id], `${card.name} is on your showcase`)}
          />
          <Button onClick={() => setOpen(false)} className="self-end">
            Done
          </Button>
        </div>
      </Dialog>
    </SettingsSection>
  );
}
