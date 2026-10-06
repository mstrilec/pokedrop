import {
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
