import { WalletPageSchema, type WalletQuerySchema } from '@pokedrop/shared';
import type { z } from 'zod';
import { get } from '../core';

export type WalletParams = z.input<typeof WalletQuerySchema>;

export const wallet = (params: WalletParams = {}) => get('/wallet', WalletPageSchema, params);
