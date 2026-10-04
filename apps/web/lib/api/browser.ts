import { createClient } from './core';

export const api = createClient({ baseUrl: '/api/v1', headers: () => ({}) });

/** Better Auth's own routes, which live beside /api/v1, not under it. */
export const authApi = createClient({ baseUrl: '/api/auth', headers: () => ({}) });
