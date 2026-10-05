import type { QueryKey } from '@tanstack/react-query';
import type { CardSearchParams } from '@/lib/api/endpoints/catalog';
import type { InventoryParams } from '@/lib/api/endpoints/inventory';
import type { WalletParams } from '@/lib/api/endpoints/wallet';

// Every query key comes from here. Each resource has a root, `all`, which
// stale times and invalidations target; a key under it extends that root.
export const keys = {
  me: ['me'],
  catalog: {
    all: ['catalog'],
    facets: ['catalog', 'facets'],
    sets: ['catalog', 'sets'],
    search: (params: CardSearchParams = {}) => ['catalog', 'search', params],
    browse: (params: CardSearchParams = {}) => ['catalog', 'browse', params],
  },
  prices: { all: ['prices'] },
  inventory: {
    all: ['inventory'],
    list: (params: InventoryParams = {}) => ['inventory', 'list', params],
    summary: ['inventory', 'summary'],
    owned: (cardIds: readonly string[]) => ['inventory', 'owned', cardIds],
  },
  wallet: {
    all: ['wallet'],
    list: (params: WalletParams = {}) => ['wallet', 'list', params],
  },
  packs: {
    all: ['packs'],
    history: ['packs', 'history'],
    templates: ['packs', 'templates'],
  },
  decks: { all: ['decks'] },
  trades: { all: ['trades'] },
  notifications: {
    all: ['notifications'],
    unreadCount: ['notifications', 'unread-count'],
    list: (params: { unread: boolean }) => ['notifications', 'list', params],
  },
  profiles: { all: ['profiles'] },
  admin: { all: ['admin'] },
} as const satisfies Record<
  string,
  QueryKey | Record<string, QueryKey | ((...args: never[]) => QueryKey)>
>;
