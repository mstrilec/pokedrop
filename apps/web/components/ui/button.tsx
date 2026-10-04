import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { Slot } from 'radix-ui';

const buttonVariants = cva(
  'focus-ring inline-flex shrink-0 cursor-pointer items-center justify-center rounded-control border border-transparent whitespace-nowrap transition select-none disabled:pointer-events-none disabled:opacity-40 aria-busy:cursor-progress [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-pri-strong font-semibold text-on-pri shadow-sm hover:bg-pri-strong-hover hover:shadow-glow',
        secondary: 'border-bd-2 bg-surface-2 font-semibold text-tx hover:border-mut hover:bg-elev',
        ghost: 'font-medium text-mut hover:bg-surface-2 hover:text-tx',
        confirm: 'bg-grn font-bold text-on-grn hover:brightness-108',
        destructive: 'border-red/30 bg-red-dim font-semibold text-red hover:bg-red/20',
        economy: 'bg-gold font-bold text-on-gold hover:brightness-106',
      },
      size: {
        sm: 'h-8 gap-2 px-3 text-small font-semibold [&_svg]:size-3.5',
        md: 'h-10 gap-2 px-4.5 text-body [&_svg]:size-4',
        lg: 'h-12 gap-2.5 px-6.5 text-h3 font-bold [&_svg]:size-4.5',
      },
    },
    compoundVariants: [
      { variant: 'primary', size: 'lg', className: 'shadow-glow' },
      { variant: 'ghost', size: 'md', className: 'px-3.5' },
    ],
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    icon?: LucideIcon;
    loading?: boolean;
  };

function Button({
  className,
  variant,
  size,
  asChild = false,
  icon: Icon,
  loading = false,
  type = 'button',
  onClick,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : type}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      // Busy stays focusable, so a pending submit keeps its focus; Enter must do nothing.
      onClick={
        loading ? (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault() : onClick
      }
      {...props}
    >
      {loading ? (
        <LoaderCircle aria-hidden className="animate-spin" />
      ) : Icon ? (
        <Icon aria-hidden />
      ) : null}
      <Slot.Slottable>{children}</Slot.Slottable>
    </Comp>
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
