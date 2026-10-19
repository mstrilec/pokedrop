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
  cancelTrade: ['cancelTrade'],
  updateMe: ['updateMe'],
  revokeOtherSessions: ['revokeOtherSessions'],
  changePassword: ['changePassword'],
  savePackTemplate: ['savePackTemplate'],
  triggerSync: ['triggerSync'],
  resetBreaker: ['resetBreaker'],
  adminUserAction: ['adminUserAction'],
  voidTrade: ['voidTrade'],
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
  saveDeck: [keys.decks.all, keys.inventory.ownedAll, keys.progress],
  acceptTrade: [
    keys.trades.all,
    keys.inventory.all,
    keys.wallet.all,
    keys.me,
    keys.decks.all,
    keys.notifications.all,
  ],
  declineTrade: [keys.trades.all, keys.notifications.all],
  cancelTrade: [keys.trades.all, keys.inventory.all, keys.notifications.all],
  updateMe: [keys.me, keys.profiles.all],
  revokeOtherSessions: [keys.sessions],
  changePassword: [keys.sessions],
  savePackTemplate: [keys.admin.packTemplates, keys.packs.all],
  triggerSync: [keys.admin.sync],
  resetBreaker: [keys.admin.sync],
  adminUserAction: [keys.admin.users, keys.admin.all],
  voidTrade: [keys.admin.all, keys.trades.all, keys.inventory.all, keys.wallet.all, keys.me],
  proposeTrade: [keys.trades.all, keys.inventory.all, keys.notifications.all],
  counterTrade: [keys.trades.all, keys.inventory.all, keys.notifications.all],
};

export function invalidatedBy(mutationKey: QueryKey | undefined): readonly QueryKey[] {
  const name = mutationKey?.[0];
  return typeof name === 'string' && name in INVALIDATES ? INVALIDATES[name as MutationName] : [];
}
