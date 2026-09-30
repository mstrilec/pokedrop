import { createClient } from './core';

export const api = createClient({ baseUrl: '/api/v1', headers: () => ({}) });
