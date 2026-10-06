import type {
  AdminUserPage,
  AdminUserRow,
  CreatePackTemplate,
  GrantCurrency,
  MetricsWindow,
  Role,
  SyncStatusResponse,
  SyncTriggerKind,
  UpdatePackTemplate,
} from '@pokedrop/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import {
  adminMetrics,
  adminPackTemplates,
  type AdminUserParams,
  adminUsers,
  changeRole,
  createPackTemplate,
  grantCurrency,
  resetBreaker,
  suspendUser,
  syncStatus,
  triggerSync,
  unsuspendUser,
  updatePackTemplate,
} from '@/lib/api/endpoints/admin';
import { mutationKeys } from './invalidation';
import { keys } from './keys';

export function useAdminMetrics(days: MetricsWindow) {
  return useQuery({
    queryKey: keys.admin.metrics(days),
    queryFn: () => api.call(adminMetrics(days)),
    placeholderData: keepPreviousData,
  });
}

export function useAdminPackTemplates() {
  return useQuery({
    queryKey: keys.admin.packTemplates,
    queryFn: () => api.call(adminPackTemplates()),
  });
}

/** Create without an id, edit with one; the form reports a refusal itself. */
export function useSavePackTemplate() {
  return useMutation({
    mutationKey: mutationKeys.savePackTemplate,
    mutationFn: ({
      id,
      body,
    }: {
      id: string | null;
      body: CreatePackTemplate | UpdatePackTemplate;
    }) =>
      api.call(
        id === null
          ? createPackTemplate(body as CreatePackTemplate)
          : updatePackTemplate(id, body as UpdatePackTemplate),
      ),
    meta: { toast: false },
  });
}

const ACTIVE_POLL_MS = 2_000;
const IDLE_POLL_MS = 15_000;

/** Something queued or running: either kind's queue holds a job, or a run is open and alive. */
export function syncBusy(status: SyncStatusResponse | undefined): boolean {
  if (!status) return false;
  const queued = (status.queues ?? []).some(
    (q) =>
      (q.queue === 'catalog-sync' || q.queue === 'price-sweep') &&
      q.waiting + q.active + q.delayed > 0,
  );
  const running = (status.runs ?? []).some(
    (run) => run.status === 'RUNNING' && run.stale !== true && run.kind !== 'PRICE_ACTIVE',
  );
  return queued || running;
}

/** Polled every 2 s while a sync is queued or running, so its progress moves on the page. */
export function useSyncStatus() {
  return useQuery({
    queryKey: keys.admin.sync,
    queryFn: () => api.call(syncStatus()),
    refetchInterval: (query) => (syncBusy(query.state.data) ? ACTIVE_POLL_MS : IDLE_POLL_MS),
  });
}

export function useTriggerSync() {
  return useMutation({
    mutationKey: mutationKeys.triggerSync,
    mutationFn: (kind: SyncTriggerKind) => api.call(triggerSync(kind)),
    meta: { toast: false },
  });
}

export function useResetBreaker() {
  return useMutation({
    mutationKey: mutationKeys.resetBreaker,
    mutationFn: (provider: string) => api.call(resetBreaker(provider)),
  });
}

export function useAdminUsers(params: AdminUserParams) {
  return useQuery({
    queryKey: keys.admin.userList(params),
    queryFn: () => api.call(adminUsers(params)),
    placeholderData: keepPreviousData,
  });
}

export type UserAction =
  | { kind: 'grant'; user: AdminUserRow; body: GrantCurrency }
  | { kind: 'role'; user: AdminUserRow; role: Role }
  | { kind: 'suspend'; user: AdminUserRow; reason: string }
  | { kind: 'unsuspend'; user: AdminUserRow };

/** What the row will read once the server agrees; shown at once, put back if it refuses. */
function expected(action: UserAction): Partial<AdminUserRow> {
  switch (action.kind) {
    case 'grant':
      return { currency: action.user.currency + action.body.amount };
    case 'role':
      return { role: action.role };
    case 'suspend':
      return { suspendedAt: new Date() };
    case 'unsuspend':
      return { suspendedAt: null };
  }
}

export function useAdminUserAction() {
  const queryClient = useQueryClient();
  const patchRow = (id: string, change: Partial<AdminUserRow>) =>
    queryClient.setQueriesData<AdminUserPage>({ queryKey: keys.admin.users }, (page) =>
      page
        ? { ...page, items: page.items.map((row) => (row.id === id ? { ...row, ...change } : row)) }
        : page,
    );

  return useMutation({
    mutationKey: mutationKeys.adminUserAction,
    mutationFn: async (action: UserAction): Promise<Partial<AdminUserRow>> => {
      const id = action.user.id;
      switch (action.kind) {
        case 'grant':
          return { currency: (await api.call(grantCurrency(id, action.body))).balance };
        case 'role':
          return api.call(changeRole(id, { role: action.role }));
        case 'suspend':
          return api.call(suspendUser(id, { reason: action.reason }));
        case 'unsuspend':
          return api.call(unsuspendUser(id));
      }
    },
    onMutate: async (action) => {
      await queryClient.cancelQueries({ queryKey: keys.admin.users });
      const before = queryClient.getQueriesData<AdminUserPage>({ queryKey: keys.admin.users });
      patchRow(action.user.id, expected(action));
      return { before };
    },
    onError: (_error, _action, context) => {
      for (const [key, page] of context?.before ?? []) queryClient.setQueryData(key, page);
    },
    onSuccess: (row, action) => patchRow(action.user.id, row),
  });
}
