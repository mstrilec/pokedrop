export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_COOKIE = 'theme';

/** Anything but an explicit light or dark is System, the default. */
export function parseTheme(value: string | undefined): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function themeAttribute(preference: ThemePreference): 'light' | 'dark' | undefined {
  return preference === 'system' ? undefined : preference;
}
