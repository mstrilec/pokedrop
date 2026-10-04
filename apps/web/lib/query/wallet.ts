import type { WalletQuery } from '@pokedrop/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import { wallet } from '@/lib/api/endpoints/wallet';
import { keys } from './keys';

export function useWallet(type: WalletQuery['type']) {
  return useInfiniteQuery({
    queryKey: keys.wallet.list({ type }),
    queryFn: ({ pageParam }) => api.call(wallet({ type, cursor: pageParam })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
