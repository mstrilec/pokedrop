import 'server-only';
import { z } from 'zod';

// PokéAPI is the one external service a page reads at request time (D9 in docs/Pages.md):
// free, keyless, and optional — any failure is no section, never an error.
const BASE = 'https://pokeapi.co/api/v2';
const DAY = 86_400;
const TIMEOUT_MS = 2_000;

const English = z.object({ language: z.object({ name: z.string() }) });

const SpeciesSchema = z.object({
  name: z.string(),
  genera: z.array(English.extend({ genus: z.string() })),
  flavor_text_entries: z.array(English.extend({ flavor_text: z.string() })),
});

const PokemonSchema = z.object({
  height: z.number(),
  weight: z.number(),
  stats: z.array(z.object({ base_stat: z.number(), stat: z.object({ name: z.string() }) })),
});

export type Species = {
  dex: number;
  genus: string | null;
  flavor: string | null;
  heightM: number;
  weightKg: number;
  stats: { name: string; value: number }[];
};

const STAT_NAMES: Record<string, string> = {
  hp: 'HP',
  attack: 'Attack',
  defense: 'Defense',
  'special-attack': 'Sp. Atk',
  'special-defense': 'Sp. Def',
  speed: 'Speed',
};

async function read<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  const response = await fetch(`${BASE}${path}`, {
    next: { revalidate: DAY },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`PokéAPI ${path}: ${response.status}`);
  return schema.parse(await response.json());
}

/** The video-game Pokédex entry for a national number, or null when PokéAPI cannot say. */
export async function speciesFor(dex: number): Promise<Species | null> {
  try {
    const [species, pokemon] = await Promise.all([
      read(`/pokemon-species/${dex}`, SpeciesSchema),
      read(`/pokemon/${dex}`, PokemonSchema),
    ]);
    const english = <T extends z.infer<typeof English>>(entries: T[]) =>
      entries.filter((entry) => entry.language.name === 'en');
    const flavor = english(species.flavor_text_entries).at(-1)?.flavor_text ?? null;
    return {
      dex,
      genus: english(species.genera)[0]?.genus ?? null,
      // The game text keeps its line breaks and form feeds.
      flavor: flavor?.replace(/[\s\f]+/g, ' ').trim() ?? null,
      heightM: pokemon.height / 10,
      weightKg: pokemon.weight / 10,
      stats: pokemon.stats.map((entry) => ({
        name: STAT_NAMES[entry.stat.name] ?? entry.stat.name,
        value: entry.base_stat,
      })),
    };
  } catch (error) {
    console.warn(`Species ${dex} unavailable:`, error instanceof Error ? error.message : error);
    return null;
  }
}
