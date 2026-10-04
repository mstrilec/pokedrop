import type { RarityTier } from '@pokedrop/shared';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { type LucideIcon, X } from 'lucide-react';
import { RARITY_STYLES } from '@/lib/design/rarity';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'accent';

const badgeVariants = cva('inline-flex shrink-0 items-center font-semibold whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'border-bd-2 bg-surface-2 text-mut',
      primary: 'border-pri/30 bg-pri-dim text-pri',
      success: 'border-grn/30 bg-grn/14 text-grn',
      warning: 'border-gold/30 bg-gold-dim text-gold',
      danger: 'border-red/30 bg-red-dim text-red',
      accent: 'border-rarity-ultra-border bg-rarity-ultra-tint text-rarity-ultra',
    },
    shape: {
      pill: 'gap-1.5 rounded-pill px-3 py-1 text-caption tracking-normal',
      tag: 'gap-1 rounded-tag px-1.5 py-0.5 text-[10px] leading-4',
    },
    bordered: { true: 'border', false: 'border-0' },
  },
  defaultVariants: { tone: 'neutral', shape: 'pill', bordered: false },
});

type BadgeProps = {
  label: string;
  tone?: BadgeTone;
  /** Takes the rarity ramp's colors and border; `label` defaults to the tier's name. */
  rarity?: RarityTier;
  shape?: 'pill' | 'tag';
  bordered?: boolean;
  dot?: boolean;
  icon?: LucideIcon;
  /** Announce changes to the label politely. */
  live?: boolean;
  onDismiss?: () => void;
  className?: string;
};

export function Badge({
  label,
  tone,
  rarity,
  shape = 'pill',
  bordered,
  dot = shape === 'pill',
  icon: Icon,
  live,
  onDismiss,
  className,
}: BadgeProps) {
  const rarityChip = rarity ? cn(RARITY_STYLES[rarity].chip, 'border') : undefined;

  return (
    <span
      role={live ? 'status' : undefined}
      className={cn(badgeVariants({ tone, shape, bordered }), rarityChip, className)}
    >
      {Icon ? (
        <Icon aria-hidden className="size-3.5" />
      ) : dot ? (
        <span aria-hidden className="size-1.75 rounded-pill bg-current" />
      ) : null}
      {label}
      {onDismiss ? (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={onDismiss}
          className="focus-ring -mr-1 flex size-4 cursor-pointer items-center justify-center rounded-pill opacity-70 hover:opacity-100"
        >
          <X aria-hidden className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

export function RarityBadge({
  rarity,
  ...props
}: Omit<BadgeProps, 'label' | 'rarity' | 'tone'> & { rarity: RarityTier; label?: string }) {
  return <Badge rarity={rarity} label={props.label ?? RARITY_STYLES[rarity].label} {...props} />;
}
