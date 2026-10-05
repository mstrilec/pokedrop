import { MyProfileSchema, PublicProfileSchema, UserSearchResultSchema } from '@pokedrop/shared';
import { get } from '../core';

export const me = () => get('/users/me', MyProfileSchema);

export const publicProfile = (id: string) => get(`/users/${id}`, PublicProfileSchema);

export const userSearch = (q: string) => get('/users', UserSearchResultSchema, { q });
