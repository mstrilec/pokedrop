/** A design token's computed value on `:root`, for code that cannot use `var()`. */
export function token(name: `--${string}`): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
