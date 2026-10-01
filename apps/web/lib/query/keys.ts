import type { QueryKey } from '@tanstack/react-query';
import type { InventoryParams } from '@/lib/api/endpoints/inventory';
import type { WalletParams } from '@/lib/api/endpoints/wallet';

// Every query key comes from here. Each resource has a root, `all`, which
// stale times and invalidations target; a key under it extends that root.
export const keys = {
  me: ['me'],
  catalog: { all: ['catalog'] },
  prices: { all: ['prices'] },
  inventory: {
    all: ['inventory'],
    list: (params: InventoryParams = {}) => ['inventory', 'list', params],
  },
  wallet: {
    all: ['wallet'],
    list: (params: WalletParams = {}) => ['wallet', 'list', params],
  },
  packs: { all: ['packs'] },
  decks: { all: ['decks'] },
  trades: { all: ['trades'] },
  notifications: {
    all: ['notifications'],
    unreadCount: ['notifications', 'unread-count'],
  },
  profiles: { all: ['profiles'] },
  admin: { all: ['admin'] },
} as const satisfies Record<
  string,
  QueryKey | Record<string, QueryKey | ((...args: never[]) => QueryKey)>
>;
