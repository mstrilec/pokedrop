import type { PackTemplateId } from '@pokedrop/shared';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import { openPack, packHistory, packTemplates } from '@/lib/api/endpoints/packs';
import { mutationKeys } from './invalidation';
import { keys } from './keys';

// Each opening is a row of card tiles, so a page holds fewer than the API's default.
const HISTORY_PAGE_SIZE = 10;

export function usePackHistory() {
  return useInfiniteQuery({
    queryKey: keys.packs.history,
    queryFn: ({ pageParam }) =>
      api.call(packHistory({ cursor: pageParam, pageSize: HISTORY_PAGE_SIZE })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

// The caller makes one openId per attempt and reuses it on a retry, so a
// repeated request replays the opening instead of buying a second pack.
export function useOpenPack() {
  return useMutation({
    mutationKey: mutationKeys.openPack,
    meta: { toast: false },
    mutationFn: ({ templateId, openId }: { templateId: PackTemplateId; openId: string }) =>
      api.call(openPack(templateId, { openId })),
  });
}

export function usePackTemplates() {
  return useQuery({ queryKey: keys.packs.templates, queryFn: () => api.call(packTemplates()) });
}
