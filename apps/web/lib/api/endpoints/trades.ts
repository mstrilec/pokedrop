import {
  type TradeInboxQuerySchema,
  type TradeLine,
  TradeDetailSchema,
  TradePageSchema,
  TradeSchema,
} from '@pokedrop/shared';
import { z } from 'zod';
import { get, post } from '../core';

export type TradeInboxParams = z.input<typeof TradeInboxQuerySchema>;

export type TradeTermsBody = {
  offered: TradeLine[];
  requested: TradeLine[];
  currencyFromInitiator: number;
  currencyFromRecipient: number;
};
export type ProposeTradeBody = TradeTermsBody & { recipientId: string };

export const trades = (params: TradeInboxParams = {}) => get('/trades', TradePageSchema, params);

/** A trade the caller is a party to; 404 to anyone else. */
export const trade = (id: string) => get(`/trades/${id}`, TradeDetailSchema);

export const proposeTrade = (body: ProposeTradeBody) => post('/trades', TradeSchema, body);

export const counterTrade = (id: string, body: TradeTermsBody) =>
  post(`/trades/${id}/counter`, TradeSchema, body);

export const acceptTrade = (id: string) => post(`/trades/${id}/accept`, TradeSchema);

export const declineTrade = (id: string) => post(`/trades/${id}/decline`, TradeSchema);
