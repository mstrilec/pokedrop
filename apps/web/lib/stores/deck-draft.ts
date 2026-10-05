import {
  type CardId,
  type DeckCardInput,
  type DeckDetail,
  type DeckFormat,
  DeckFormatSchema,
  type DeckValidation,
  type PlayableCard,
} from '@pokedrop/shared';
import { createStore } from 'zustand/vanilla';
import { createStoreContext } from './context';

// The deck being edited, before it is saved: the one place a card list is held outside
// TanStack Query. Seeded once from the server's copy; later refetches of that copy (the
// Public switch invalidates every deck query) never touch it. Only a save replaces it.
export type DeckDraft = {
  name: string;
  format: DeckFormat;
  ownedOnly: boolean;
  cards: DeckCardInput[];
};

export interface DeckDraftStore {
  saved: DeckDraft;
  draft: DeckDraft;
  /** What the validator, the rows and the charts read about each card in the draft. */
  cardsById: Record<string, PlayableCard>;
  /** Available copies per card id; an absent id is not known yet. */
  available: Record<string, number>;
  /** The server's verdict from the last save, shown until the next change. */
  verdict: DeckValidation | null;
  add: (card: PlayableCard, available?: number) => void;
  remove: (cardId: CardId) => void;
  setCount: (cardId: CardId, count: number) => void;
  setName: (name: string) => void;
  setFormat: (format: DeckFormat) => void;
  setOwnedOnly: (ownedOnly: boolean) => void;
  learnAvailable: (counts: Record<string, number>) => void;
  reset: (deck: DeckDetail, verdict?: DeckValidation) => void;
}

export function countIn(cards: DeckCardInput[], cardId: string): number {
  return cards.find((card) => card.cardId === cardId)?.count ?? 0;
}

function withCount(cards: DeckCardInput[], cardId: CardId, count: number): DeckCardInput[] {
  if (count < 1) return cards.filter((card) => card.cardId !== cardId);
  return cards.some((card) => card.cardId === cardId)
    ? cards.map((card) => (card.cardId === cardId ? { cardId, count } : card))
    : [...cards, { cardId, count }];
}

function draftOf(deck: DeckDetail): DeckDraft {
  const format = DeckFormatSchema.safeParse(deck.format);
  return {
    name: deck.name,
    format: format.success ? format.data : 'standard',
    ownedOnly: deck.ownedOnly,
    cards: deck.cards.map(({ cardId, count }) => ({ cardId, count })),
  };
}

function cardsOf(deck: DeckDetail): Record<string, PlayableCard> {
  return Object.fromEntries(deck.cards.map((entry) => [entry.cardId, entry.card]));
}

export function isDirty({ saved, draft }: Pick<DeckDraftStore, 'saved' | 'draft'>): boolean {
  if (
    saved.name !== draft.name ||
    saved.format !== draft.format ||
    saved.ownedOnly !== draft.ownedOnly ||
    saved.cards.length !== draft.cards.length
  ) {
    return true;
  }
  return draft.cards.some((card) => countIn(saved.cards, card.cardId) !== card.count);
}

export const [DeckDraftProvider, useDeckDraft] = createStoreContext(
  'useDeckDraft',
  ({ deck }: { deck: DeckDetail }) =>
    createStore<DeckDraftStore>()((set) => {
      const edit = (change: (draft: DeckDraft) => Partial<DeckDraft>) =>
        set((s) => ({ draft: { ...s.draft, ...change(s.draft) }, verdict: null }));
      return {
        saved: draftOf(deck),
        draft: draftOf(deck),
        cardsById: cardsOf(deck),
        available: {},
        verdict: null,
        add: (card, available) =>
          set((s) => ({
            draft: {
              ...s.draft,
              cards: withCount(s.draft.cards, card.id, countIn(s.draft.cards, card.id) + 1),
            },
            cardsById: card.id in s.cardsById ? s.cardsById : { ...s.cardsById, [card.id]: card },
            available:
              available === undefined || card.id in s.available
                ? s.available
                : { ...s.available, [card.id]: available },
            verdict: null,
          })),
        remove: (cardId) =>
          edit((d) => ({ cards: withCount(d.cards, cardId, countIn(d.cards, cardId) - 1) })),
        setCount: (cardId, count) => edit((d) => ({ cards: withCount(d.cards, cardId, count) })),
        setName: (name) => edit(() => ({ name })),
        setFormat: (format) => edit(() => ({ format })),
        setOwnedOnly: (ownedOnly) => edit(() => ({ ownedOnly })),
        learnAvailable: (counts) => set((s) => ({ available: { ...s.available, ...counts } })),
        reset: (next, verdict) =>
          set({
            saved: draftOf(next),
            draft: draftOf(next),
            cardsById: cardsOf(next),
            available: {},
            verdict: verdict ?? null,
          }),
      };
    }),
);
