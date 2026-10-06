import type { PriceHistory, PricePoint } from '@pokedrop/shared';
import { Clock, TriangleAlert } from 'lucide-react';
import { formatEur, formatUsd } from '@/components/cards/card-data';
import { dateTime, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

// A price older than this is still shown, with its age called out.
const STALE_DAYS = 7;
const DAY_MS = 86_400_000;

function Sparkline({ points, label }: { points: PricePoint[]; label: string }) {
  if (points.length < 2) {
    return (
      <p className="flex h-12 items-center text-small text-faint">
        {points.length === 0 ? 'No price history in the last 30 days' : 'One price in 30 days'}
      </p>
    );
  }
  const values = points.map((point) => point.market);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const first = Date.parse(points[0]!.capturedOn);
  const width = Date.parse(points.at(-1)!.capturedOn) - first || 1;
  const path = points
    .map((point, index) => {
      const x = ((Date.parse(point.capturedOn) - first) / width) * 200;
      const y = 44 - ((point.market - low) / span) * 40;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 200 48"
      preserveAspectRatio="none"
      className="h-12 w-full"
    >
      <path d={`${path} L200,48 L0,48 Z`} className="fill-pri/10" />
      <path
        d={path}
        fill="none"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        className="stroke-pri"
      />
    </svg>
  );
}

function PriceBlock({
  source,
  latest,
  points,
  format,
}: {
  source: string;
  latest: number | null;
  points: PricePoint[];
  format: (value: number | null) => string;
}) {
  const values = points.map((point) => point.market);
  const first = values[0];
  const last = values.at(-1);
  const change =
    first !== undefined && last !== undefined && first > 0 && values.length > 1
      ? ((last - first) / first) * 100
      : null;
  const label =
    values.length > 1
      ? `${source} over 30 days: ${format(first ?? null)} to ${format(last ?? null)}, low ${format(Math.min(...values))}, high ${format(Math.max(...values))}`
      : `${source}: no 30-day chart`;

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-control border border-bd bg-bg p-4">
      <p className="text-small text-mut">{source}</p>
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-h2 font-semibold text-tx">
          {latest === null ? 'No price' : format(latest)}
        </span>
        {change !== null ? (
          <span className={cn('font-mono text-small', change >= 0 ? 'text-grn' : 'text-red')}>
            {change >= 0 ? '+' : '−'}
            {Math.abs(change).toFixed(1)}% in 30 days
          </span>
        ) : null}
      </p>
      <Sparkline points={points} label={label} />
      {values.length > 1 ? (
        <dl className="flex gap-6 text-small">
          <div>
            <dt className="text-faint">30d low</dt>
            <dd className="font-mono text-tx">{format(Math.min(...values))}</dd>
          </div>
          <div>
            <dt className="text-faint">30d high</dt>
            <dd className="font-mono text-tx">{format(Math.max(...values))}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

/** Latest TCGplayer and Cardmarket prices, each with its 30 days; the age always shown. */
export function CardPrices({
  usd,
  eur,
  updatedAt,
  history,
  now,
}: {
  usd: number | null;
  eur: number | null;
  updatedAt: Date | null;
  history: PriceHistory | null;
  now: Date;
}) {
  const stale = updatedAt !== null && now.getTime() - updatedAt.getTime() > STALE_DAYS * DAY_MS;
  return (
    <section aria-labelledby="prices-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="prices-heading" className="text-h3">
          Market price
        </h2>
        {updatedAt ? (
          <p
            className={cn('flex items-center gap-1.5 text-small', stale ? 'text-gold' : 'text-mut')}
          >
            {stale ? (
              <TriangleAlert aria-hidden className="size-4" />
            ) : (
              <Clock aria-hidden className="size-4" />
            )}
            Updated{' '}
            <time dateTime={updatedAt.toISOString()} title={dateTime(updatedAt)}>
              {timeAgo(updatedAt, now)}
            </time>
            {stale ? ' — may be out of date' : null}
          </p>
        ) : (
          <p className="text-small text-mut">Not priced yet</p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <PriceBlock
          source="TCGplayer · USD"
          latest={usd}
          points={history?.series.TCGPLAYER.points ?? []}
          format={formatUsd}
        />
        <PriceBlock
          source="Cardmarket · EUR"
          latest={eur}
          points={history?.series.CARDMARKET.points ?? []}
          format={formatEur}
        />
      </div>
    </section>
  );
}
