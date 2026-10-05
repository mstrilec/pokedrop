'use client';

import type { ChartDatum, DeckStats } from '@pokedrop/shared';
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { energyStyle } from '@/lib/design/energy';
import { RARITY_STYLES, rarityTier } from '@/lib/design/rarity';

const SUPERTYPE_COLORS: Record<string, string> = {
  Pokémon: 'var(--pri)',
  Trainer: 'var(--gold)',
  Energy: 'var(--grn)',
};

function summary(data: ChartDatum[]): string {
  return data.length === 0 ? 'None yet' : data.map((d) => `${d.name} ${d.value}`).join(', ');
}

function ChartFigure({
  title,
  column,
  data,
  colorOf,
}: {
  title: string;
  column: string;
  data: ChartDatum[];
  colorOf: (name: string) => string;
}) {
  const shown = data.filter((d) => d.value > 0);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-small font-semibold text-tx">{title}</span>
        <span className="text-[12px] text-mut">{summary(shown)}</span>
      </figcaption>
      {shown.length > 0 ? (
        // The caption and the table below say the same; the bars are for the eye.
        <div aria-hidden style={{ height: shown.length * 28 + 8 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={shown}
              layout="vertical"
              margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
            >
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={88}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--mut)', fontSize: 12 }}
              />
              <Bar dataKey="value" radius={4} isAnimationActive={false}>
                {shown.map((d) => (
                  <Cell key={d.name} fill={colorOf(d.name)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{column}</th>
            <th scope="col">Copies</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((d) => (
            <tr key={d.name}>
              <th scope="row">{d.name}</th>
              <td>{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function DeckStatsCharts({ stats }: { stats: DeckStats }) {
  return (
    <section
      aria-label="Deck stats"
      className="flex flex-col gap-4 rounded-card border border-bd bg-surface p-4"
    >
      <h3 className="text-h3">Stats</h3>
      <p className="text-small text-mut">
        <span className="font-mono text-h2 font-bold text-tx">{stats.energyCount}</span> energy of{' '}
        {stats.totalCards} {stats.totalCards === 1 ? 'card' : 'cards'}
      </p>
      <ChartFigure
        title="Cards by supertype"
        column="Supertype"
        data={stats.supertypes}
        colorOf={(name) => SUPERTYPE_COLORS[name] ?? 'var(--mut)'}
      />
      <ChartFigure
        title="Pokémon by type"
        column="Type"
        data={stats.types}
        colorOf={(name) => energyStyle(name).face}
      />
      <ChartFigure
        title="Cards by rarity"
        column="Rarity"
        data={stats.rarities}
        colorOf={(name) => RARITY_STYLES[rarityTier(name)].color}
      />
    </section>
  );
}
