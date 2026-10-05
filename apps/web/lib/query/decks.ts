import type { CreateDeck, UpdateDeck } from '@pokedrop/shared';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import { cloneDeck, createDeck, deleteDeck, myDecks, updateDeck } from '@/lib/api/endpoints/decks';
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
