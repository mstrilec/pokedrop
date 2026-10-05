'use client';

import { type DeckStats, type DeckValidation, toDeckStats, validateDeck } from '@pokedrop/shared';
import { useEffect, useMemo } from 'react';
import { useOwnedCounts } from '@/lib/query/inventory';
import { useDeckDraft } from '@/lib/stores/deck-draft';

/**
 * The server's own validator over the draft, on every change. A card whose available copies
 * are not known yet counts as available, so nothing reads "not owned" before the count
 * arrives; `checkingCopies` says the ownership verdict is still settling.
 */
export function useDeckChecks(deckSize: number): {
  validation: DeckValidation;
  stats: DeckStats;
  checkingCopies: boolean;
} {
  const draft = useDeckDraft((s) => s.draft);
  const cardsById = useDeckDraft((s) => s.cardsById);
  const available = useDeckDraft((s) => s.available);
  const verdict = useDeckDraft((s) => s.verdict);
  const learnAvailable = useDeckDraft((s) => s.learnAvailable);

  const unknown = useMemo(
    () =>
      draft.cards
        .map((card) => card.cardId)
        .filter((id) => !(id in available))
        .sort(),
    [draft.cards, available],
  );
  const { owned, known } = useOwnedCounts(unknown.length > 0 ? [unknown] : [], true);

  useEffect(() => {
    const learned: Record<string, number> = {};
    for (const id of unknown) {
      if (known.has(id)) learned[id] = owned.get(id)?.available ?? 0;
    }
    if (Object.keys(learned).length > 0) learnAvailable(learned);
  }, [unknown, owned, known, learnAvailable]);

  const validation = useMemo(
    () =>
      validateDeck({
        format: draft.format,
        ownedOnly: draft.ownedOnly,
        deckSize,
        cards: draft.cards.flatMap(({ cardId, count }) => {
          const card = cardsById[cardId];
          return card
            ? [
                {
                  cardId,
                  count,
                  name: card.name,
                  supertype: card.supertype,
                  subtypes: card.subtypes,
                  legalities: card.legalities,
                },
              ]
            : [];
        }),
        available: new Map(
          draft.cards.map(({ cardId, count }) => [cardId, available[cardId] ?? count]),
        ),
      }),
    [draft, cardsById, available, deckSize],
  );

  const stats = useMemo(
    () =>
      toDeckStats(
        draft.cards.flatMap(({ cardId, count }) => {
          const card = cardsById[cardId];
          return card
            ? [{ supertype: card.supertype, rarity: card.rarity, types: card.types, count }]
            : [];
        }),
      ),
    [draft.cards, cardsById],
  );

  return { validation: verdict ?? validation, stats, checkingCopies: unknown.length > 0 };
}
