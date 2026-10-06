import {
  DeckPageSchema,
  MyProfileSchema,
  PublicProfileSchema,
  type UpdateMyProfile,
  UserSearchResultSchema,
} from '@pokedrop/shared';
import { get, patch } from '../core';

export const me = () => get('/users/me', MyProfileSchema);

export const updateMe = (body: UpdateMyProfile) => patch('/users/me', MyProfileSchema, body);

export const publicProfile = (id: string) =>
  get(`/users/${encodeURIComponent(id)}`, PublicProfileSchema);

/** Only the decks the user made public, newest first. */
export const userDecks = (id: string, page = 1) =>
  get(`/users/${encodeURIComponent(id)}/decks`, DeckPageSchema, { page });

export const userSearch = (q: string) => get('/users', UserSearchResultSchema, { q });
