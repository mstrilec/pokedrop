import { cn } from '@/lib/utils';

type CompletionMeterProps = {
  label: string;
  value: number;
  max: number;
  /** A CSS color, usually a token: `var(--e-fire)` for a set-themed bar. */
  color?: string;
  /** Track thickness in px. */
  height?: number;
  /** Hide the label and count row when the surrounding layout already shows them. */
  showHeader?: boolean;
  unit?: string;
  className?: string;
};

export function percentOf(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round((Math.min(Math.max(value, 0), max) / max) * 100);
}

export function CompletionMeter({
  label,
  value,
  max,
  color = 'var(--pri)',
  height = 7,
  showHeader = true,
  unit = 'cards',
  className,
}: CompletionMeterProps) {
  const percent = percentOf(value, max);
  const count = `${value.toLocaleString('en-US')}/${max.toLocaleString('en-US')}`;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {showHeader ? (
        <div aria-hidden className="flex items-baseline justify-between gap-3">
          <span className="text-small text-mut">{label}</span>
          <span className="font-mono text-small text-tx">
            {count} · {percent}%
          </span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(Math.max(value, 0), max)}
        aria-valuetext={`${value.toLocaleString('en-US')} of ${max.toLocaleString('en-US')} ${unit}, ${percent}%`}
        className="overflow-hidden rounded-pill bg-bg"
        style={{ height }}
      >
        <div
          className="h-full rounded-pill transition-[width] duration-500 ease-reveal"
          style={{ width: `${percent}%`, background: color }}
        />
      </div>
    </div>
  );
}
