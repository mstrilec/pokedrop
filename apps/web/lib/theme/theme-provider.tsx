'use client';

import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { type ResolvedTheme, THEME_COOKIE, type ThemePreference, themeAttribute } from './theme';

const LIGHT = '(prefers-color-scheme: light)';
const YEAR = 60 * 60 * 24 * 365;

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference(next: ThemePreference): void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const subscribe = (change: () => void) => {
  const list = matchMedia(LIGHT);
  list.addEventListener('change', change);
  return () => list.removeEventListener('change', change);
};

function writeCookie(preference: ThemePreference) {
  document.cookie =
    preference === 'system'
      ? `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
      : `${THEME_COOKIE}=${preference}; Path=/; Max-Age=${YEAR}; SameSite=Lax`;
}

/** The colours themselves come from CSS (globals.css); this only records and applies the choice. */
export function ThemeProvider({
  initial,
  children,
}: {
  initial: ThemePreference;
  children: ReactNode;
}) {
  const [preference, setState] = useState(initial);
  // The server cannot see the OS, so it answers dark; only the Toaster reads `resolved`.
  const osLight = useSyncExternalStore(
    subscribe,
    () => matchMedia(LIGHT).matches,
    () => false,
  );
  const resolved: ResolvedTheme =
    preference === 'system' ? (osLight ? 'light' : 'dark') : preference;

  const setPreference = useCallback((next: ThemePreference) => {
    const root = document.documentElement;
    // One frame without transitions, so every colour switches at once instead of fading.
    root.dataset.themeSwitching = '';
    const attribute = themeAttribute(next);
    if (attribute) root.dataset.theme = attribute;
    else delete root.dataset.theme;
    writeCookie(next);
    setState(next);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        delete root.dataset.themeSwitching;
      }),
    );
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const value = use(ThemeContext);
  if (!value) throw new Error('useTheme outside ThemeProvider');
  return value;
}
