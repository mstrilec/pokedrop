import { cn } from '@/lib/utils';

type SkeletonProps = {
  shape?: 'line' | 'block' | 'circle';
  width?: string;
  height?: string;
  className?: string;
};

const SHAPES = {
  line: 'h-3 rounded-tag',
  block: 'rounded-control',
  circle: 'aspect-square rounded-pill',
} as const;

export function Skeleton({ shape = 'line', width = '100%', height, className }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cn('block shrink-0 animate-shimmer bg-skeleton', SHAPES[shape], className)}
      style={{ width, height }}
    />
  );
}
