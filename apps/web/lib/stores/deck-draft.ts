import type { CardId, DeckCardInput } from '@pokedrop/shared';
import { createStore } from 'zustand/vanilla';
import { createStoreContext } from './context';

// The deck being edited, before it is saved. It starts from the server's copy
// but is the user's own until saved — the one place a card list is held
// outside TanStack Query. After a save, reset it from the refreshed query.
export interface DeckDraftStore {
  saved: DeckCardInput[];
  cards: DeckCardInput[];
  /** The list before the last drag, for one step of undo. */
  beforeDrag: DeckCardInput[] | null;
  add: (cardId: CardId) => void;
  remove: (cardId: CardId) => void;
  setCount: (cardId: CardId, count: number) => void;
  applyDrag: (cards: DeckCardInput[]) => void;
  undoDrag: () => void;
  reset: (cards: DeckCardInput[]) => void;
}

function countOf(cards: DeckCardInput[], cardId: CardId): number {
  return cards.find((card) => card.cardId === cardId)?.count ?? 0;
}

function withCount(cards: DeckCardInput[], cardId: CardId, count: number): DeckCardInput[] {
  if (count < 1) return cards.filter((card) => card.cardId !== cardId);
  return cards.some((card) => card.cardId === cardId)
    ? cards.map((card) => (card.cardId === cardId ? { cardId, count } : card))
    : [...cards, { cardId, count }];
}

export function isDirty({ saved, cards }: Pick<DeckDraftStore, 'saved' | 'cards'>): boolean {
  if (saved.length !== cards.length) return true;
  return cards.some((card) => countOf(saved, card.cardId) !== card.count);
}

export const [DeckDraftProvider, useDeckDraft] = createStoreContext(
  'useDeckDraft',
  ({ initial }: { initial: DeckCardInput[] }) =>
    createStore<DeckDraftStore>()((set) => ({
      saved: initial,
      cards: initial,
      beforeDrag: null,
      add: (cardId) =>
        set((s) => ({ cards: withCount(s.cards, cardId, countOf(s.cards, cardId) + 1) })),
      remove: (cardId) =>
        set((s) => ({ cards: withCount(s.cards, cardId, countOf(s.cards, cardId) - 1) })),
      setCount: (cardId, count) => set((s) => ({ cards: withCount(s.cards, cardId, count) })),
      applyDrag: (cards) => set((s) => ({ cards, beforeDrag: s.cards })),
      undoDrag: () => set((s) => (s.beforeDrag ? { cards: s.beforeDrag, beforeDrag: null } : s)),
      reset: (cards) => set({ saved: cards, cards, beforeDrag: null }),
    })),
);
