'use client';

import { useEffect } from 'react';

const KEY = 'pokedrop.session-refreshed-at';
const DAY_MS = 24 * 60 * 60 * 1000;

// /api/v1 renews a session in the database but drops the refreshed cookie;
// Better Auth's own route returns it, so the cookie rolls forward with the row.
export function SessionKeepAlive() {
  useEffect(() => {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(KEY)) || 0;
    } catch {
      // Storage unavailable: refresh on every mount instead.
    }
    if (Date.now() - last < DAY_MS) return;
    fetch('/api/auth/get-session', { cache: 'no-store' }).then(
      () => {
        try {
          sessionStorage.setItem(KEY, String(Date.now()));
        } catch {
          // Storage unavailable: nothing to remember.
        }
      },
      () => undefined,
    );
  }, []);
  return null;
}
