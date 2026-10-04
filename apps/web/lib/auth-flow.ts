import { useSyncExternalStore } from 'react';

// The address a verification mail went to, kept for the check-your-inbox page
// so it never has to travel in a URL. sessionStorage: this tab only.
const PENDING_KEY = 'pokedrop.pending-verification';

export const RESEND_COOLDOWN_MS = 60_000;

export type PendingVerification = { email: string; sentAt: number };

export function rememberPendingVerification(email: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ email, sentAt: Date.now() }));
  } catch {
    // Storage refused (private mode): the page asks for the address instead.
  }
}

export function forgetPendingVerification(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to clear.
  }
}

function readRaw(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): PendingVerification | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (
      typeof value === 'object' &&
      value !== null &&
      'email' in value &&
      'sentAt' in value &&
      typeof value.email === 'string' &&
      typeof value.sentAt === 'number'
    ) {
      return { email: value.email, sentAt: value.sentAt };
    }
  } catch {
    // Unreadable is the same as absent.
  }
  return null;
}

const noSubscription = () => () => {};

/** null on the server and until the browser has read storage. */
export function usePendingVerification(): PendingVerification | null {
  const raw = useSyncExternalStore(noSubscription, readRaw, () => null);
  return parse(raw);
}

/** Where a verification link lands once the address is confirmed. */
export function verifiedCallbackUrl(): string {
  return `${window.location.origin}/verify-email?verified=1`;
}
