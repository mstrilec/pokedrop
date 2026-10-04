import { cn } from '@/lib/utils';

type SkeletonProps = {
  shape?: 'line' | 'block' | 'circle';
  /** Any CSS length; give the size of the content it stands in for, so nothing moves on load. */
  width?: string;
  height?: string;
  className?: string;
};

const SHAPES = {
  line: 'h-3 rounded-tag',
  block: 'rounded-control',
  circle: 'aspect-square rounded-pill',
} as const;

// The container that is loading carries aria-busy; the placeholder itself is hidden.
export function Skeleton({ shape = 'line', width = '100%', height, className }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cn('block shrink-0 animate-shimmer bg-skeleton', SHAPES[shape], className)}
      style={{ width, height }}
    />
  );
}
