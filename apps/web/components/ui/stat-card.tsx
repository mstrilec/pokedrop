import { type LucideIcon, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useId } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

type Tone = 'primary' | 'success' | 'warning' | 'accent' | 'danger';

const TONES: Record<Tone, string> = {
  primary: 'bg-pri-dim text-pri',
  success: 'bg-grn/14 text-grn',
  warning: 'bg-gold-dim text-gold',
  accent: 'bg-rarity-ultra-tint text-rarity-ultra',
  danger: 'bg-red-dim text-red',
};

const TRENDS = {
  up: { icon: TrendingUp, className: 'text-grn', spoken: 'Up' },
  down: { icon: TrendingDown, className: 'text-red', spoken: 'Down' },
  flat: { icon: Minus, className: 'text-mut', spoken: 'No change' },
} as const;

type StatCardProps = {
  label: string;
  /** Already formatted: `$2,480`, `1,250`, `98%`. */
  value: string;
  icon?: LucideIcon;
  tone?: Tone;
  trend?: string;
  trendTone?: keyof typeof TRENDS;
  compact?: boolean;
  loading?: boolean;
  className?: string;
};

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'primary',
  trend,
  trendTone = 'up',
  compact = false,
  loading = false,
  className,
}: StatCardProps) {
  const labelId = useId();
  const direction = TRENDS[trendTone];
  const TrendIcon = direction.icon;

  return (
    <section
      aria-labelledby={labelId}
      aria-busy={loading || undefined}
      className={cn(
        'rounded-card border border-bd bg-surface',
        compact ? 'p-4' : 'p-4.5',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id={labelId} className="text-small text-mut">
          {label}
        </h3>
        {Icon ? (
          <span
            aria-hidden
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-control',
              TONES[tone],
            )}
          >
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>
      {loading ? (
        <div className="mt-3.5 flex flex-col gap-2">
          <Skeleton shape="block" width="7rem" height={compact ? '22px' : '28px'} />
          {trend !== undefined ? <Skeleton width="5rem" /> : null}
        </div>
      ) : (
        <>
          <p
            className={cn(
              'mt-3.5 font-mono font-bold tracking-tight text-tx',
              compact ? 'text-[20px]' : 'text-[26px]',
            )}
          >
            {value}
          </p>
          {trend ? (
            <p className={cn('mt-1 flex items-center gap-1 text-small', direction.className)}>
              <TrendIcon aria-hidden className="size-3.5" />
              <span className="sr-only">{direction.spoken}: </span>
              {trend}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
