'use client';

import type { DeckStats, DeckValidation } from '@pokedrop/shared';
import { DeckValidationBanner } from '@/components/decks/deck-validation-banner';
import { Spinner } from '@/components/ui/spinner';
import { useDeckDraft } from '@/lib/stores/deck-draft';

export function DeckChecks({
  validation,
  stats,
  checkingCopies,
  onSelectCard,
}: {
  validation: DeckValidation;
  stats: DeckStats;
  checkingCopies: boolean;
  onSelectCard: (cardId: string) => void;
}) {
  const cardsById = useDeckDraft((s) => s.cardsById);
  const names = Object.fromEntries(Object.values(cardsById).map((card) => [card.id, card.name]));

  return (
    <div id="deck-checks" tabIndex={-1} className="flex flex-col gap-4 outline-none">
      <DeckValidationBanner validation={validation} cardNames={names} onSelectCard={onSelectCard} />
      {checkingCopies ? (
        <p role="status" className="flex items-center gap-2 text-small text-mut">
          <Spinner size={14} /> Checking your copies…
        </p>
      ) : null}
      <p className="sr-only">{stats.totalCards} cards in the draft.</p>
    </div>
  );
}
