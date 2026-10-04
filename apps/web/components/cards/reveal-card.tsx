'use client';

import { Zap } from 'lucide-react';
import type { CSSProperties } from 'react';
import { isHighRarity, RARITY_STYLES, rarityTier } from '@/lib/design/rarity';
import { cn } from '@/lib/utils';
import { CardArt } from './card-art';
import type { CardView } from './card-data';

type RevealCardProps = {
  card: CardView;
  /** Face up. Turning it true flips the card over. */
  revealed?: boolean;
  /** The rare-pull glow behind the card, once it is face up. */
  highlight?: boolean;
  /** Enter with a flip-in, delayed by `index` steps (the summary grid). */
  appear?: boolean;
  index?: number;
  size?: 'tile' | 'large';
  sizes?: string;
  className?: string;
};

const STAGGER_MS = 80;

export function RevealCard({
  card,
  revealed = true,
  highlight = false,
  appear = false,
  index = 0,
  size = 'tile',
  sizes = size === 'large' ? '290px' : '(min-width: 1024px) 180px, 45vw',
  className,
}: RevealCardProps) {
  const tier = rarityTier(card.rarity);
  const style = RARITY_STYLES[tier];
  const rarityLabel = card.rarity ?? tier;
  const glowing = highlight && revealed;
  const radius = size === 'large' ? 'rounded-modal' : 'rounded-tile';

  return (
    <figure
      className={cn('relative m-0', appear && 'animate-flip-in', className)}
      style={appear ? { animationDelay: `${index * STAGGER_MS}ms` } : undefined}
    >
      {glowing ? (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute -inset-1/4 rounded-pill',
            isHighRarity(tier) ? 'animate-pulse-glow opacity-90' : 'opacity-50',
          )}
          style={{ background: `radial-gradient(circle, ${style.color}, transparent 66%)` }}
        />
      ) : null}
      <div className="relative aspect-[5/7] [perspective:1600px]">
        <div
          className="relative size-full transition-transform duration-[650ms] ease-reveal [transform-style:preserve-3d]"
          style={{ transform: revealed ? 'rotateY(180deg)' : 'none' }}
        >
          <div
            aria-hidden
            className={cn(
              'absolute inset-0 flex items-center justify-center overflow-hidden border border-white/15 bg-card-back shadow-lg [backface-visibility:hidden]',
              radius,
            )}
          >
            <div className={cn('absolute inset-3 border border-white/10', radius)} />
            <div className="flex size-2/5 items-center justify-center rounded-pill bg-linear-135 from-pri to-rarity-rare shadow-glow">
              <Zap className="size-1/2 text-white" />
            </div>
          </div>
          <div
            aria-hidden
            className={cn(
              'absolute inset-0 overflow-hidden border-2 shadow-lg [backface-visibility:hidden] [transform:rotateY(180deg)]',
              radius,
            )}
            style={
              {
                borderColor: style.color,
                boxShadow: glowing
                  ? `0 0 34px color-mix(in srgb, ${style.color} 66%, transparent)`
                  : undefined,
              } as CSSProperties
            }
          >
            <CardArt card={card} size={size} sizes={sizes} />
            <span className="absolute right-2 bottom-2 flex items-center gap-1.5 rounded-pill bg-black/40 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
              <span className="size-1.75 rounded-pill" style={{ background: style.color }} />
              {rarityLabel}
            </span>
          </div>
        </div>
      </div>
      <figcaption className="sr-only">
        {revealed ? `${card.name}, ${rarityLabel}` : 'Face-down card'}
      </figcaption>
    </figure>
  );
}
