import 'server-only';
import { cache } from 'react';
import { makeQueryClient } from './client';

export const getServerQueryClient = cache(makeQueryClient);
