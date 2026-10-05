'use client';

import { Lock } from 'lucide-react';
import type { HTMLAttributes, Ref } from 'react';
import { RARITY_STYLES, rarityTier } from '@/lib/design/rarity';
import { cn } from '@/lib/utils';
import { CardArt } from '../cards/card-art';
import { type CardView, setNumber } from '../cards/card-data';
import { CopyCountStepper } from './copy-count-stepper';

export const deckSlotId = (cardId: string) => `deck-slot-${cardId}`;

const HIGHLIGHT_MS = 1600;

/** Scroll a decklist row into view, focus it and flash it: where a validation error points. */
export function focusDeckSlot(cardId: string): boolean {
  const slot = document.getElementById(deckSlotId(cardId));
  if (!slot) return false;
  // An explicit 'smooth' wins over the reduced-motion CSS rule, so ask the media query.
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  slot.scrollIntoView({ block: 'center', behavior: still ? 'instant' : 'smooth' });
  slot.focus({ preventScroll: true });
  slot.dataset.highlight = 'true';
  setTimeout(() => delete slot.dataset.highlight, HIGHLIGHT_MS);
  return true;
}

type DeckSlotProps = {
  card: CardView;
  count: number;
  /** The card is promised in a pending trade; its count cannot change here. */
  locked?: boolean;
  /** Drag feedback for the builder, which owns the drag itself. */
  dragging?: boolean;
  dropTarget?: boolean;
  className?: string;
  ref?: Ref<HTMLDivElement>;
  /** Makes the art and name a drag handle: dnd-kit's activator ref, attributes and listeners. */
  handle?: HTMLAttributes<HTMLDivElement> & { ref?: (element: HTMLElement | null) => void };
} & (
  | { readOnly?: false; max: number; onChange: (count: number) => void }
  | { readOnly: true; max?: never; onChange?: never }
);

export function DeckSlot(props: DeckSlotProps) {
  const {
    card,
    count,
    locked = false,
    dragging = false,
    dropTarget = false,
    className,
    ref,
    handle,
  } = props;
  const tier = rarityTier(card.rarity);
  return (
    <div
      ref={ref}
      id={deckSlotId(card.id)}
      tabIndex={-1}
      className={cn(
        'flex items-center gap-3 rounded-tile border border-bd bg-surface px-3 py-2.5 transition outline-none hover:bg-surface-2',
        'data-[highlight=true]:border-gold data-[highlight=true]:ring-2 data-[highlight=true]:ring-gold/40',
        dragging && 'opacity-50',
        dropTarget && 'border-dashed border-pri bg-pri-dim',
        className,
      )}
    >
      <div
        {...handle}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3 rounded-tag',
          handle && 'focus-ring cursor-grab touch-none active:cursor-grabbing',
        )}
      >
        <div className="relative aspect-[5/7] w-10 shrink-0 overflow-hidden rounded-tag">
          <CardArt card={card} sizes="40px" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-small font-semibold text-tx">{card.name}</span>
          <span className="flex items-center gap-2 text-[11px]">
            <span className="font-mono text-mut">{setNumber(card.id)}</span>
            <span className={RARITY_STYLES[tier].text}>{card.rarity ?? tier}</span>
          </span>
          {locked ? (
            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-gold">
              <Lock aria-hidden className="size-3" />
              Locked in a pending trade
            </span>
          ) : null}
        </div>
      </div>
      {props.readOnly ? (
        <span className="font-mono text-mono text-tx">×{count}</span>
      ) : (
        <CopyCountStepper
          count={count}
          max={props.max}
          onChange={props.onChange}
          cardName={card.name}
          disabled={locked}
        />
      )}
    </div>
  );
}
