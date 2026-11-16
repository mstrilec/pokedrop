import 'server-only';
import { headers } from 'next/headers';
import { env } from '../env';
import { createClient } from './core';

export async function serverHeaders(): Promise<Record<string, string>> {
  const incoming = await headers();
  const out: Record<string, string> = { Origin: env.WEB_ORIGIN };
  const cookie = incoming.get('cookie');
  if (cookie) out.cookie = cookie;
  const forwarded = incoming.get('x-forwarded-for');
  if (forwarded) out['x-forwarded-for'] = forwarded;
  return out;
}

export const serverApi = createClient({
  baseUrl: `${env.API_INTERNAL_URL}/api/v1`,
  headers: serverHeaders,
  init: { cache: 'no-store' },
  // A hung API otherwise holds every server render for undici's 10 s connect timeout, twice.
  getTimeoutMs: 5000,
});
