export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_COOKIE = 'theme';

export function parseTheme(value: string | undefined): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function themeAttribute(preference: ThemePreference): 'light' | 'dark' | undefined {
  return preference === 'system' ? undefined : preference;
}
