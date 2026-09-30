import 'server-only';
import { ERROR_CODES, type MyProfile } from '@pokedrop/shared';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { ApiError } from '@/lib/api/core';
import { me } from '@/lib/api/endpoints/users';
import { serverApi } from '@/lib/api/server';
import { hasSessionCookie } from './cookie';

export type SessionResult =
  { profile: MyProfile } | { profile: null; reason: 'signed-out' | 'suspended' };

export const getSession = cache(async (): Promise<SessionResult> => {
  if (!hasSessionCookie(await cookies())) return { profile: null, reason: 'signed-out' };
  try {
    return { profile: await serverApi.call(me()) };
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 401) {
      return { profile: null, reason: 'signed-out' };
    }
    if (error instanceof ApiError && error.code === ERROR_CODES.ACCOUNT_SUSPENDED) {
      return { profile: null, reason: 'suspended' };
    }
    throw error;
  }
});
