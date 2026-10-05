// The database compares names under a C collation, where only ASCII letters fold case:
// `É` and `é` stay different there, so they must stay different here.
export function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** The server's rule for `q`: a substring of the name, ASCII case ignored, `%` `_` `\` literal. */
export function matchesName(name: string, query: string): boolean {
  return asciiLower(name).includes(asciiLower(query.trim()));
}

export type Narrowed<T> = { items: T[]; stale: boolean };

/**
 * What may be shown while the field says `typed` and the items on screen answer `answered`:
 * always a subset of what the server returns for `typed`, never something else.
 */
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
