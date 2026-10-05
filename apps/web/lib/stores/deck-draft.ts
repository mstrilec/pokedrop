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
// TanStack Query. Seeded from the server's copy; a newer copy replaces it only while it is
// clean (`reset`), and a save replaces it only if nothing was edited meanwhile (`commit`).
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
  /** `updatedAt` of the server copy `saved` came from, in ms. */
  basis: number;
  add: (card: PlayableCard, available?: number) => void;
  remove: (cardId: CardId) => void;
  setCount: (cardId: CardId, count: number) => void;
  setName: (name: string) => void;
  setFormat: (format: DeckFormat) => void;
  setOwnedOnly: (ownedOnly: boolean) => void;
  learnAvailable: (counts: Record<string, number>) => void;
  /** Start again from a server copy: the first one, or a newer one while the draft is clean. */
  reset: (deck: DeckDetail) => void;
  /** A save answered. `sent` is the draft it sent; edits made since stay, and stay dirty. */
  commit: (deck: DeckDetail, verdict: DeckValidation, sent: DeckDraft) => void;
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
        basis: deck.updatedAt.getTime(),
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
        reset: (next) =>
          set({
            saved: draftOf(next),
            draft: draftOf(next),
            cardsById: cardsOf(next),
            available: {},
            verdict: null,
            basis: next.updatedAt.getTime(),
          }),
        commit: (next, verdict, sent) =>
          set((s) => ({
            saved: draftOf(next),
            draft: s.draft === sent ? draftOf(next) : s.draft,
            cardsById: { ...s.cardsById, ...cardsOf(next) },
            available: {},
            verdict: s.draft === sent ? verdict : null,
            basis: next.updatedAt.getTime(),
          })),
      };
    }),
);
