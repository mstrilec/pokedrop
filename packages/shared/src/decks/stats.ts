import {
  DECK_SUPERTYPES,
  DeckStatsSchema,
  type ChartDatum,
  type DeckStats,
} from '../entities/deck.js';

export type StatsRow = {
  supertype: string;
  rarity: string | null;
  types: string[];
  count: number;
};

const NO_RARITY = 'Unknown';

export function toDeckStats(rows: StatsRow[]): DeckStats {
  const supertypes = new Map<string, number>(DECK_SUPERTYPES.map((name) => [name, 0]));
  const types = new Map<string, number>();
  const rarities = new Map<string, number>();
  let totalCards = 0;

  for (const row of rows) {
    totalCards += row.count;
    add(supertypes, row.supertype, row.count);
    add(rarities, row.rarity ?? NO_RARITY, row.count);
    if (row.supertype === 'Pokémon') {
      for (const type of row.types) {
        add(types, type, row.count);
      }
    }
  }

  return DeckStatsSchema.parse({
    totalCards,
    energyCount: supertypes.get('Energy') ?? 0,
    supertypes: [...supertypes].map(([name, value]) => ({ name, value })),
    types: largestFirst(types),
    rarities: largestFirst(rarities),
  });
}

function add(tally: Map<string, number>, key: string, count: number): void {
  tally.set(key, (tally.get(key) ?? 0) + count);
}

function largestFirst(tally: Map<string, number>): ChartDatum[] {
  return [...tally]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
