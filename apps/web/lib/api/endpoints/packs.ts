import {
  PackHistoryPageSchema,
  type PackHistoryQuerySchema,
  PackOpenResultSchema,
  type OpenPackRequestSchema,
  type PackTemplateId,
} from '@pokedrop/shared';
import type { z } from 'zod';
import { get, post } from '../core';

export type PackHistoryParams = z.input<typeof PackHistoryQuerySchema>;

export const openPack = (templateId: PackTemplateId, body: z.input<typeof OpenPackRequestSchema>) =>
  post(`/packs/${templateId}/open`, PackOpenResultSchema, body);

export const packHistory = (params: PackHistoryParams = {}) =>
  get('/packs/history', PackHistoryPageSchema, params);
