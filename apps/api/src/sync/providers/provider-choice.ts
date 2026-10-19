export interface ChosenProvider<T extends string> {
  name: T;
  isFallback: boolean;
}

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
