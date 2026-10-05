import {
  baseCardName,
  copyLimitKey,
  DECK_MAX_COPIES,
  DECK_NAME_MAX,
  type DeckCardInput,
  MAX_DECK_CARD_COUNT,
  MAX_DECK_ENTRIES,
} from '@pokedrop/shared';
import type { DeckDraft } from '@/lib/stores/deck-draft';

type RuleCard = { id: string; name: string; supertype: string; subtypes: readonly string[] };

export const NO_CHANGES = 'No changes to save';

/**
 * How many copies of `card` the deck may hold, counting every other printing of its name;
 * Infinity for basic energy. The same key the API's validator uses, from @pokedrop/shared.
 */
export function copiesAllowed(card: RuleCard, deck: { card: RuleCard; count: number }[]): number {
  const key = copyLimitKey(card);
  if (key === null) return Number.POSITIVE_INFINITY;
  const others = deck
    .filter((entry) => entry.card.id !== card.id && copyLimitKey(entry.card) === key)
    .reduce((sum, entry) => sum + entry.count, 0);
  return Math.max(0, DECK_MAX_COPIES - others);
}

function entriesOf(cards: DeckCardInput[], cardsById: Record<string, RuleCard>) {
  return cards.flatMap((entry) => {
    const card = cardsById[entry.cardId];
    return card ? [{ card, count: entry.count }] : [];
  });
}

/** The stepper's ceiling for a decklist row: the copy limit, or the request bound for energy. */
export function slotMax(
  card: RuleCard,
  cards: DeckCardInput[],
  cardsById: Record<string, RuleCard>,
): number {
  return Math.min(copiesAllowed(card, entriesOf(cards, cardsById)), MAX_DECK_CARD_COUNT);
}

/** Why one more copy of `card` cannot go in, or null. *+ Add* and a drop both ask. */
export function addRefusal(
  card: RuleCard,
  cards: DeckCardInput[],
  cardsById: Record<string, RuleCard>,
): string | null {
  const count = cards.find((entry) => entry.cardId === card.id)?.count ?? 0;
  if (count === 0 && cards.length >= MAX_DECK_ENTRIES) {
    return `A deck holds at most ${MAX_DECK_ENTRIES} different cards`;
  }
  if (count >= MAX_DECK_CARD_COUNT) return `At most ${MAX_DECK_CARD_COUNT} copies of one card`;
  if (count >= copiesAllowed(card, entriesOf(cards, cardsById))) {
    return `${baseCardName(card.name)} is at the ${DECK_MAX_COPIES}-copy limit`;
  }
  return null;
}

/** What keeps Save disabled: only what the API would refuse with a 400 (D4), or no change. */
export function saveBlocker(draft: DeckDraft, dirty: boolean): string | null {
  if (!dirty) return NO_CHANGES;
  const name = draft.name.trim();
  if (name === '') return 'Name the deck';
  if (name.length > DECK_NAME_MAX) return `Use at most ${DECK_NAME_MAX} characters`;
  if (draft.cards.length > MAX_DECK_ENTRIES) {
    return `A deck holds at most ${MAX_DECK_ENTRIES} different cards`;
  }
  return null;
}
