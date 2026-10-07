import {
  type AdminTradeQuerySchema,
  type AdminUserListQuerySchema,
  AuditPageSchema,
  type AuditQuerySchema,
  TradeDetailSchema,
  TradePageSchema,
  TradeSchema,
  VoidCheckSchema,
  AdminUserPageSchema,
  AdminUserRowSchema,
  type ChangeRole,
  type GrantCurrency,
  GrantResultSchema,
  ProviderBreakerStateSchema,
  type SuspendUser,
  SyncStatusResponseSchema,
  type SyncTriggerKind,
  SyncTriggerResultSchema,
  AdminMetricsSchema,
  type CreatePackTemplate,
  type MetricsWindow,
  PackTemplateSchema,
  type UpdatePackTemplate,
} from '@pokedrop/shared';
import { z } from 'zod';
import { get, patch, post } from '../core';

export const adminMetrics = (days: MetricsWindow) =>
  get('/admin/metrics', AdminMetricsSchema, { days: String(days) });

/** Every template, inactive ones included. */
export const adminPackTemplates = () => get('/admin/pack-templates', z.array(PackTemplateSchema));

export const createPackTemplate = (body: CreatePackTemplate) =>
  post('/admin/pack-templates', PackTemplateSchema, body);

export const updatePackTemplate = (id: string, body: UpdatePackTemplate) =>
  patch(`/admin/pack-templates/${encodeURIComponent(id)}`, PackTemplateSchema, body);

export type AdminUserParams = z.input<typeof AdminUserListQuerySchema>;

export const adminUsers = (params: AdminUserParams) =>
  get('/admin/users', AdminUserPageSchema, params);

const userPath = (id: string, action: string) => `/admin/users/${encodeURIComponent(id)}/${action}`;

export const grantCurrency = (id: string, body: GrantCurrency) =>
  post(userPath(id, 'currency'), GrantResultSchema, body);

export const changeRole = (id: string, body: ChangeRole) =>
  patch(userPath(id, 'role'), AdminUserRowSchema, body);

export const suspendUser = (id: string, body: SuspendUser) =>
  post(userPath(id, 'suspend'), AdminUserRowSchema, body);

export const unsuspendUser = (id: string) => post(userPath(id, 'unsuspend'), AdminUserRowSchema);

export const syncStatus = () => get('/admin/sync/status', SyncStatusResponseSchema);

/** 202 `{ jobId, kind }`; 409 `SYNC_IN_PROGRESS` while either kind holds the key. */
export const triggerSync = (kind: SyncTriggerKind) =>
  post(kind === 'CATALOG' ? '/admin/sync/catalog' : '/admin/sync/prices', SyncTriggerResultSchema);

export const resetBreaker = (provider: string) =>
  post(`/admin/sync/breakers/${encodeURIComponent(provider)}/reset`, ProviderBreakerStateSchema);

export type AdminTradeParams = z.input<typeof AdminTradeQuerySchema>;
export type AuditParams = z.input<typeof AuditQuerySchema>;

export const adminTrades = (params: AdminTradeParams) =>
  get('/admin/trades', TradePageSchema, params);

export const adminTrade = (id: string) =>
  get(`/admin/trades/${encodeURIComponent(id)}`, TradeDetailSchema);

export const voidCheck = (id: string) =>
  get(`/admin/trades/${encodeURIComponent(id)}/void-check`, VoidCheckSchema);

export const voidTrade = (id: string, reason: string) =>
  post(`/admin/trades/${encodeURIComponent(id)}/void`, TradeSchema, { reason });

export const auditLog = (params: AuditParams) => get('/admin/audit', AuditPageSchema, params);
