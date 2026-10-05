import {
  type CreateDeckSchema,
  type DeckListQuerySchema,
  DeckDetailSchema,
  DeckSaveResultSchema,
  OwnDeckPageSchema,
  type UpdateDeckSchema,
} from '@pokedrop/shared';
import { z } from 'zod';
import { del, get, patch, post } from '../core';

export type DeckListParams = z.input<typeof DeckListQuerySchema>;

export const myDecks = (params: DeckListParams = {}) => get('/decks', OwnDeckPageSchema, params);

/** Public decks for anyone; a private one only for its owner (otherwise 404). */
export const deck = (id: string) => get(`/decks/${id}`, DeckDetailSchema);

export const createDeck = (body: z.input<typeof CreateDeckSchema>) =>
  post('/decks', DeckSaveResultSchema, body);

export const updateDeck = (id: string, body: z.input<typeof UpdateDeckSchema>) =>
  patch(`/decks/${id}`, DeckSaveResultSchema, body);

export const cloneDeck = (id: string) => post(`/decks/${id}/clone`, DeckSaveResultSchema);

/** 204, no body. */
export const deleteDeck = (id: string) => del(`/decks/${id}`, z.undefined());
