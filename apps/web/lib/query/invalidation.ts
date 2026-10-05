import type { QueryKey } from '@tanstack/react-query';
import { keys } from './keys';

export const mutationKeys = {
  openPack: ['openPack'],
  markNotificationRead: ['markNotificationRead'],
  markAllNotificationsRead: ['markAllNotificationsRead'],
  createDeck: ['createDeck'],
  updateDeck: ['updateDeck'],
  cloneDeck: ['cloneDeck'],
  deleteDeck: ['deleteDeck'],
  saveDeck: ['saveDeck'],
  acceptTrade: ['acceptTrade'],
  declineTrade: ['declineTrade'],
  proposeTrade: ['proposeTrade'],
  counterTrade: ['counterTrade'],
} as const;

type MutationName = keyof typeof mutationKeys;

// What each mutation makes stale. MutationCache applies it on every success,
// so a mutation hook only has to carry its mutationKey.
export const INVALIDATES: Record<MutationName, readonly QueryKey[]> = {
  openPack: [keys.me, keys.wallet.all, keys.inventory.all, keys.packs.all],
  markNotificationRead: [keys.notifications.all],
  markAllNotificationsRead: [keys.notifications.all],
  createDeck: [keys.decks.all],
  updateDeck: [keys.decks.all],
  cloneDeck: [keys.decks.all],
  deleteDeck: [keys.decks.all],
  // A save's verdict counts the owner's copies; the builder's counts follow it.
  saveDeck: [keys.decks.all, keys.inventory.ownedAll],
  // Settlement moves cards and coins both ways; a deck's verdict counts the copies it moved.
  acceptTrade: [
    keys.trades.all,
    keys.inventory.all,
    keys.wallet.all,
    keys.me,
    keys.decks.all,
    keys.notifications.all,
  ],
  declineTrade: [keys.trades.all, keys.notifications.all],
  // The offered copies are locked now; the inbox and its counts change.
  proposeTrade: [keys.trades.all, keys.inventory.all, keys.notifications.all],
  counterTrade: [keys.trades.all, keys.inventory.all, keys.notifications.all],
};

export function invalidatedBy(mutationKey: QueryKey | undefined): readonly QueryKey[] {
  const name = mutationKey?.[0];
  return typeof name === 'string' && name in INVALIDATES ? INVALIDATES[name as MutationName] : [];
}
