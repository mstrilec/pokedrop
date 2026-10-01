import { isServer, MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/core';
import { isProtected, redirectToSignIn } from '@/lib/routes';
import { toastApiError } from '@/lib/toast';
import { invalidatedBy } from './invalidation';
import { keys } from './keys';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

// Above zero everywhere, or data hydrated from a server render refetches on mount.
const DEFAULT_STALE_TIME = 30 * SECOND;

const STALE_TIMES: [QueryKey, number][] = [
  [keys.catalog.all, 30 * MINUTE],
  [keys.prices.all, 10 * MINUTE],
  [keys.me, 15 * SECOND],
  [keys.inventory.all, 15 * SECOND],
  [keys.wallet.all, 15 * SECOND],
  [keys.trades.all, 15 * SECOND],
  [keys.notifications.all, 15 * SECOND],
];

// A public page may hold a query that needs a session; losing the session
// there is not a reason to leave the page.
function onError(error: unknown): void {
  if (
    !isServer &&
    error instanceof ApiError &&
    error.statusCode === 401 &&
    isProtected(window.location.pathname)
  ) {
    redirectToSignIn();
  }
}

export function makeQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      // lib/api/core.ts already retries a failed GET once; mutations never.
      queries: { staleTime: DEFAULT_STALE_TIME, retry: false },
      mutations: { retry: false },
    },
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({
      // A failed mutation always tells the user, unless it opts out with meta.toast = false.
      onError: (error, _variables, _result, mutation) => {
        onError(error);
        if (mutation.meta?.toast !== false) toastApiError(error);
      },
      onSuccess: (_data, _variables, _result, mutation, context) =>
        Promise.all(
          invalidatedBy(mutation.options.mutationKey).map((queryKey) =>
            context.client.invalidateQueries({ queryKey }),
          ),
        ),
    }),
  });
  for (const [queryKey, staleTime] of STALE_TIMES) client.setQueryDefaults(queryKey, { staleTime });
  return client;
}

let browserClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  browserClient ??= makeQueryClient();
  return browserClient;
}
