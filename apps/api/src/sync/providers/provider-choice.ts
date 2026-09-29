export interface ChosenProvider<T extends string> {
  name: T;
  isFallback: boolean;
}

/**
 * The primary unless its breaker is open, then the first other provider in
 * registration order whose breaker is closed, else none. Pure so the admin
 * status can report what the next run would choose without importing the
 * providers module.
 */
export function chooseProvider<T extends string>(
  primary: T,
  names: readonly T[],
  open: ReadonlySet<T>,
): ChosenProvider<T> | null {
  if (!open.has(primary)) {
    return { name: primary, isFallback: false };
  }
  const fallback = names.find((name) => name !== primary && !open.has(name));
  return fallback === undefined ? null : { name: fallback, isFallback: true };
}
