import { DECK_SUPERTYPES } from '@pokedrop/shared';

export type DeckGroup<T> = { label: string; total: number; entries: T[] };

const byName = new Intl.Collator('en');

/** Pokémon, Trainer, Energy — then anything the mirror calls otherwise — each sorted by name. */
export function groupBySupertype<T extends { count: number }>(
  entries: T[],
  cardOf: (entry: T) => { name: string; supertype: string },
): DeckGroup<T>[] {
  const labels = [
    ...DECK_SUPERTYPES,
    ...new Set(
      entries
        .map((entry) => cardOf(entry).supertype)
        .filter((supertype) => !(DECK_SUPERTYPES as readonly string[]).includes(supertype)),
    ),
  ];
  return labels.flatMap((label) => {
    const own = entries
      .filter((entry) => cardOf(entry).supertype === label)
      .sort((a, b) => byName.compare(cardOf(a).name, cardOf(b).name));
    return own.length === 0
      ? []
      : [{ label, total: own.reduce((sum, entry) => sum + entry.count, 0), entries: own }];
  });
}
