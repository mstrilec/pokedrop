import { MyProfileSchema } from '@pokedrop/shared';
import { get } from '../core';

export const me = () => get('/users/me', MyProfileSchema);
