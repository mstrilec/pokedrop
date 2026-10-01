import type { QueryKey } from '@tanstack/react-query';
import { keys } from './keys';

export const mutationKeys = {
  openPack: ['openPack'],
} as const;

type MutationName = keyof typeof mutationKeys;

// What each mutation makes stale. MutationCache applies it on every success,
// so a mutation hook only has to carry its mutationKey.
export const INVALIDATES: Record<MutationName, readonly QueryKey[]> = {
  openPack: [keys.me, keys.wallet.all, keys.inventory.all, keys.packs.all],
};

export function invalidatedBy(mutationKey: QueryKey | undefined): readonly QueryKey[] {
  const name = mutationKey?.[0];
  return typeof name === 'string' && name in INVALIDATES ? INVALIDATES[name as MutationName] : [];
}
