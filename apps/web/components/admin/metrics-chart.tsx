'use client';

import type { MetricsDay } from '@pokedrop/shared';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export type ChartMetric = 'packsOpened' | 'activeUsers' | 'tradesAccepted' | 'tradesProposed';

/** One metric over the window; today's bar, still filling, is drawn faded. */
export function MetricsChart({ series, metric }: { series: MetricsDay[]; metric: ChartMetric }) {
  const data = series.map((day) => ({
    day: day.day.slice(5),
    value: day[metric],
    partial: day.partial,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: -16 }}>
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tick={{ fill: 'var(--faint)', fontSize: 11 }}
          interval="preserveStartEnd"
        />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tick={{ fill: 'var(--faint)', fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: 'var(--surface-2)' }}
          contentStyle={{
            background: 'var(--surface)',
            border: '1px solid var(--bd)',
            borderRadius: 8,
          }}
          labelStyle={{ color: 'var(--mut)' }}
          itemStyle={{ color: 'var(--tx)' }}
        />
        <Bar dataKey="value" name="Value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.day} fill="var(--pri)" fillOpacity={d.partial ? 0.4 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
