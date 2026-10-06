import type { CreatePackTemplate, MetricsWindow, UpdatePackTemplate } from '@pokedrop/shared';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import {
  adminMetrics,
  adminPackTemplates,
  createPackTemplate,
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
