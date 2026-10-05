import type {
  CreateDeck,
  DeckCardInput,
  DeckDetail,
  DeckFormat,
  UpdateDeck,
} from '@pokedrop/shared';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/core';
import {
  cloneDeck,
  createDeck,
  deck,
  deleteDeck,
  myDecks,
  updateDeck,
} from '@/lib/api/endpoints/decks';
import { mutationKeys } from './invalidation';
import { keys } from './keys';

export function useMyDecks() {
  return useInfiniteQuery({
    queryKey: keys.decks.mine,
    queryFn: ({ pageParam }) => api.call(myDecks({ page: pageParam })),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
}

export function useCreateDeck() {
  return useMutation({
    mutationKey: mutationKeys.createDeck,
    mutationFn: (body: Pick<CreateDeck, 'name' | 'format'>) => api.call(createDeck(body)),
  });
}

export function useUpdateDeck() {
  return useMutation({
    mutationKey: mutationKeys.updateDeck,
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDeck }) =>
      api.call(updateDeck(id, patch)),
  });
}

export function useCloneDeck() {
  return useMutation({
    mutationKey: mutationKeys.cloneDeck,
    mutationFn: (id: string) => api.call(cloneDeck(id)),
  });
}

export function useDeleteDeck() {
  return useMutation({
    mutationKey: mutationKeys.deleteDeck,
    mutationFn: (id: string) => api.call(deleteDeck(id)),
  });
}

export function useDeck(id: string, initial?: DeckDetail) {
  return useQuery({
    queryKey: keys.decks.detail(id),
    queryFn: () => api.call(deck(id)),
    initialData: initial,
    // A 404 is an answer (gone, or someone's private deck), not a failure to retry.
    retry: (failures, error) =>
      !(error instanceof ApiError && error.statusCode === 404) && failures < 2,
  });
}

export type DeckDraftBody = {
  name: string;
  format: DeckFormat;
  ownedOnly: boolean;
  cards: DeckCardInput[];
};

export function useSaveDeck(id: string) {
  return useMutation({
    mutationKey: mutationKeys.saveDeck,
    mutationFn: (body: DeckDraftBody) => api.call(updateDeck(id, body)),
    meta: { toast: false },
    // Offline, fail and say so rather than pause: the builder keeps the draft and Save stays.
    networkMode: 'always',
  });
}
