import {
  PackOpenResultSchema,
  type OpenPackRequestSchema,
  type PackTemplateId,
} from '@pokedrop/shared';
import type { z } from 'zod';
import { post } from '../core';

export const openPack = (templateId: PackTemplateId, body: z.input<typeof OpenPackRequestSchema>) =>
  post(`/packs/${templateId}/open`, PackOpenResultSchema, body);
