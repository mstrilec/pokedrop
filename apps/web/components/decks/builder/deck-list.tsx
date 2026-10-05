'use client';

import { Layers } from 'lucide-react';
import { cardView } from '@/components/cards/card-data';
import { groupBySupertype } from '@/components/decks/deck-groups';
import { slotMax } from '@/components/decks/deck-rules';
import { DeckSlot } from '@/components/decks/deck-slot';
import { useDeckDraft } from '@/lib/stores/deck-draft';

export function DeckList() {
  const cards = useDeckDraft((s) => s.draft.cards);
  const cardsById = useDeckDraft((s) => s.cardsById);
  const setCount = useDeckDraft((s) => s.setCount);
  const entries = cards.flatMap((entry) => {
    const card = cardsById[entry.cardId];
    return card ? [{ ...entry, card }] : [];
  });
  const groups = groupBySupertype(entries, (entry) => entry.card);
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="flex items-center justify-between text-h3">
        Decklist
        <span className="font-mono text-small text-mut">
          {total} {total === 1 ? 'card' : 'cards'}
        </span>
      </h2>
      {groups.length === 0 ? (
        <p className="flex flex-col items-center gap-2 rounded-card border border-dashed border-bd-2 p-6 text-center text-small text-mut">
          <Layers aria-hidden className="size-5" />
          Drag cards here or press + Add
        </p>
      ) : null}
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-2">
          <h3 className="flex items-center justify-between text-small font-semibold text-mut">
            {group.label}
            <span className="font-mono">{group.total}</span>
          </h3>
          <ul className="flex flex-col gap-2">
            {group.entries.map((entry) => (
              <li key={entry.cardId}>
                <DeckSlot
                  card={cardView(entry.card)}
                  count={entry.count}
                  max={slotMax(entry.card, cards, cardsById)}
                  onChange={(count) => setCount(entry.cardId, count)}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
