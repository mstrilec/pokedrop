import type { TradeTab } from '@pokedrop/shared';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import {
  acceptTrade,
  counterTrade,
  declineTrade,
  type ProposeTradeBody,
  proposeTrade,
  trade,
  trades,
  type TradeTermsBody,
} from '@/lib/api/endpoints/trades';
import { mutationKeys } from './invalidation';
import { keys } from './keys';

export function useTrades(tab: TradeTab) {
  return useInfiniteQuery({
    queryKey: keys.trades.list(tab),
    queryFn: ({ pageParam }) => api.call(trades({ tab, cursor: pageParam })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** A tab's size alone: one row asked for, `total` read. */
export function useTradeCount(tab: TradeTab) {
  return useQuery({
    queryKey: keys.trades.count(tab),
    queryFn: () => api.call(trades({ tab, pageSize: 1 })),
    select: (page) => page.total,
  });
}

export function useAcceptTrade() {
  return useMutation({
    mutationKey: mutationKeys.acceptTrade,
    mutationFn: (id: string) => api.call(acceptTrade(id)),
  });
}

export function useDeclineTrade() {
  return useMutation({
    mutationKey: mutationKeys.declineTrade,
    mutationFn: (id: string) => api.call(declineTrade(id)),
  });
}

export function useTrade(id: string | undefined) {
  return useQuery({
    queryKey: keys.trades.detail(id ?? ''),
    queryFn: () => api.call(trade(id ?? '')),
    enabled: id !== undefined,
    retry: false,
  });
}

export function useProposeTrade() {
  return useMutation({
    mutationKey: mutationKeys.proposeTrade,
    mutationFn: (body: ProposeTradeBody) => api.call(proposeTrade(body)),
    meta: { toast: false },
  });
}

export function useCounterTrade() {
  return useMutation({
    mutationKey: mutationKeys.counterTrade,
    mutationFn: ({ id, body }: { id: string; body: TradeTermsBody }) =>
      api.call(counterTrade(id, body)),
    meta: { toast: false },
  });
}
