import { speciesFor } from '@/lib/pokeapi';

// The highest base stat any Pokémon has (Blissey's HP); the bars share one scale.
const STAT_MAX = 255;

/** The video-game Pokédex entry; nothing at all when PokéAPI cannot answer. */
export async function CardSpecies({ dex }: { dex: number }) {
  const species = await speciesFor(dex);
  if (!species) return null;

  return (
    <section
      aria-labelledby="species-heading"
      className="flex flex-col gap-4 rounded-card border border-bd bg-surface p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="species-heading" className="text-h3">
          Pokédex #{String(species.dex).padStart(3, '0')}
          {species.genus ? <span className="text-mut"> · {species.genus}</span> : null}
        </h2>
        <p className="font-mono text-small text-faint">
          {species.heightM} m · {species.weightKg} kg
        </p>
      </div>
      {species.flavor ? (
        <blockquote className="border-l-2 border-bd-2 pl-3 text-body text-mut italic">
          {species.flavor}
        </blockquote>
      ) : null}
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {species.stats.map((stat) => (
          <div key={stat.name} className="grid grid-cols-[4.5rem_2.25rem_1fr] items-center gap-2">
            <dt className="text-small text-mut">{stat.name}</dt>
            <dd className="font-mono text-small text-tx">{stat.value}</dd>
            <div aria-hidden className="h-1.5 overflow-hidden rounded-pill bg-surface-2">
              <div
                className="h-full rounded-pill bg-pri"
                style={{ width: `${Math.min(100, (stat.value / STAT_MAX) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </dl>
      <p className="text-caption text-faint">Video-game data from PokéAPI.</p>
    </section>
  );
}
