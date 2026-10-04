import { cn } from '@/lib/utils';

type SpinnerProps = {
  /** Diameter in px. */
  size?: number;
  label?: string;
  /** Show the label beside the ring instead of only to assistive tech. */
  showLabel?: boolean;
  className?: string;
};

export function Spinner({
  size = 34,
  label = 'Loading',
  showLabel = false,
  className,
}: SpinnerProps) {
  const ring = Math.max(2, Math.round(size * 0.075));
  return (
    <span
      role="status"
      className={cn('inline-flex items-center gap-3 text-small text-mut', className)}
    >
      <span
        aria-hidden
        className="inline-block shrink-0 animate-spin rounded-pill border-bd-2 border-t-pri"
        style={{ width: size, height: size, borderWidth: ring }}
      />
      <span className={showLabel ? undefined : 'sr-only'}>{label}</span>
    </span>
  );
}
