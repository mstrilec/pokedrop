// The database compares names under a C collation, where only ASCII letters fold case:
// `É` and `é` stay different there, so they must stay different here.
export function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export function matchesName(name: string, query: string): boolean {
  return asciiLower(name).includes(asciiLower(query.trim()));
}

export type Narrowed<T> = { items: T[]; stale: boolean };

export function narrowToTyped<T>(
  items: T[],
  nameOf: (item: T) => string,
  typed: string,
  answered: string,
): Narrowed<T> {
  const next = asciiLower(typed.trim());
  const done = asciiLower(answered.trim());
  if (next === done) return { items, stale: false };
  if (next.includes(done)) {
    return { items: items.filter((item) => matchesName(nameOf(item), next)), stale: false };
  }
  if (done.includes(next)) return { items, stale: false };
  return { items, stale: true };
}

export function collectionView<T>({
  items,
  nameOf,
  typed,
  answeredQ,
  otherFiltersMatch,
  placeholder,
}: {
  items: T[];
  nameOf: (item: T) => string;
  typed: string;
  answeredQ: string;
  otherFiltersMatch: boolean;
  placeholder: boolean;
}): { items: T[]; stale: boolean; current: boolean } {
  const narrowed = narrowToTyped(items, nameOf, typed, answeredQ);
  const stale = narrowed.stale || !otherFiltersMatch;
  const current =
    !stale && !placeholder && asciiLower(typed.trim()) === asciiLower(answeredQ.trim());
  return { items: narrowed.items, stale, current };
}
