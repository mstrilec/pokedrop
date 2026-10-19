export function token(name: `--${string}`): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
