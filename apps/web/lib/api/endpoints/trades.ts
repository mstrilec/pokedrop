import { type TradeInboxQuerySchema, TradePageSchema, TradeSchema } from '@pokedrop/shared';
import { z } from 'zod';
import { get, post } from '../core';

export type TradeInboxParams = z.input<typeof TradeInboxQuerySchema>;

export const trades = (params: TradeInboxParams = {}) => get('/trades', TradePageSchema, params);

export const acceptTrade = (id: string) => post(`/trades/${id}/accept`, TradeSchema);

export const declineTrade = (id: string) => post(`/trades/${id}/decline`, TradeSchema);
