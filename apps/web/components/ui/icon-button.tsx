import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';

const iconButtonVariants = cva(
  'focus-ring relative inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-control border text-tx transition pointer-coarse:size-11 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4.25 [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        surface: 'border-bd bg-surface hover:border-bd-2 hover:bg-surface-2',
        ghost: 'border-transparent text-mut hover:bg-surface-2 hover:text-tx',
      },
    },
    defaultVariants: { variant: 'surface' },
  },
);

type IconButtonProps = Omit<React.ComponentProps<'button'>, 'children' | 'aria-label'> &
  VariantProps<typeof iconButtonVariants> & {
    icon: LucideIcon;
    label: string;
    /** A dot, or a count; either way it is spelled out in the accessible name. */
    badge?: boolean | number;
    badgeLabel?: string;
    /** A count is drawn as a dot unless asked for; the name carries it either way. */
    showCount?: boolean;
    asChild?: boolean;
    children?: React.ReactElement;
  };

export function IconButton({
  icon: Icon,
  label,
  badge = false,
  badgeLabel = 'unread',
  showCount = false,
  variant,
  asChild = false,
  type = 'button',
  className,
  children,
  ...props
}: IconButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  const count = typeof badge === 'number' ? badge : undefined;
  const flagged = count === undefined ? badge === true : count > 0;
  const name = !flagged
    ? label
    : count === undefined
      ? `${label}, ${badgeLabel}`
      : `${label}, ${count} ${badgeLabel}`;

  return (
    <Comp
      data-slot="icon-button"
      type={asChild ? undefined : type}
      aria-label={name}
      className={cn(iconButtonVariants({ variant }), className)}
      {...props}
    >
      <Icon aria-hidden />
      <Slot.Slottable>{children}</Slot.Slottable>
      {flagged && showCount && count !== undefined ? (
        <span
          aria-hidden
          className="absolute -top-1.5 -right-1.5 min-w-4.5 rounded-pill border-2 border-bg bg-red-strong px-1 text-center font-mono text-[10px] leading-3.5 font-semibold text-on-red"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : flagged ? (
        <span
          aria-hidden
          className="absolute top-2 right-2 size-2 rounded-pill border-2 border-bg bg-red"
        />
      ) : null}
    </Comp>
  );
}
