'use client';

import { useDraggable } from '@dnd-kit/core';
import type { PlayableCard } from '@pokedrop/shared';
import { Plus } from 'lucide-react';
import { memo, useId, useState } from 'react';
import { CardArt } from '@/components/cards/card-art';
import { cardView, setNumber } from '@/components/cards/card-data';
import type { Owned } from '@/lib/query/inventory';
import { cn } from '@/lib/utils';
import { type DragData, POOL_ZONE } from './builder-dnd';

type PoolTileProps = {
  card: PlayableCard;
  /** The member's copies; absent while unknown. */
  owned?: Owned;
  inDeck: number;
  /** Why *+ Add* refuses, from `addRefusal`; null when it may add. */
  refusal: string | null;
  onAdd: (card: PlayableCard, available?: number) => void;
  /** The art is a drag handle (from 1024 px). */
  draggable: boolean;
};

function ownedText(owned: Owned): string {
  if (owned.quantity === 0) return 'Not owned';
  const locked = owned.quantity - owned.available;
  return locked > 0 ? `×${owned.quantity} · ${locked} locked` : `×${owned.quantity}`;
}

function PoolTileImpl({ card, owned, inDeck, refusal, onAdd, draggable }: PoolTileProps) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `${POOL_ZONE}:${card.id}`,
    data: { from: POOL_ZONE, card, available: owned?.available } satisfies DragData,
    disabled: !draggable,
  });
  const reasonId = useId();
  const [refused, setRefused] = useState(false);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col overflow-hidden rounded-tile border border-bd bg-surface',
        isDragging && 'opacity-50',
      )}
    >
      <div
        ref={setActivatorNodeRef}
        {...(draggable ? { ...attributes, ...listeners } : {})}
        aria-label={draggable ? `${card.name} (${setNumber(card.id)})` : undefined}
        className={cn(
          'relative aspect-[5/7]',
          draggable && 'focus-ring cursor-grab touch-none active:cursor-grabbing',
        )}
      >
        <CardArt card={cardView(card)} sizes="140px" />
        {inDeck > 0 ? (
          <span className="absolute bottom-2 left-2 rounded-tag bg-pri-strong px-1.5 py-0.5 font-mono text-[10px] leading-4 font-semibold text-on-pri">
            In deck ×{inDeck}
          </span>
        ) : null}
        {owned ? (
          <span className="absolute top-2 right-2 rounded-tag bg-black/50 px-1.5 py-0.5 font-mono text-[10px] leading-4 font-semibold text-white">
            {ownedText(owned)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5 border-t border-bd px-2.5 py-2">
        <span className="truncate text-small font-semibold text-tx" title={card.name}>
          {card.name}
        </span>
        <button
          type="button"
          aria-label={`Add ${card.name} (${setNumber(card.id)}) to the deck`}
          aria-disabled={refusal !== null || undefined}
          aria-describedby={refusal !== null ? reasonId : undefined}
          onClick={() => {
            if (refusal !== null) {
              setRefused(true);
              return;
            }
            setRefused(false);
            onAdd(card, owned?.available);
          }}
          className="focus-ring inline-flex h-7 cursor-pointer items-center justify-center gap-1 rounded-tag border border-bd-2 bg-surface-2 text-small font-semibold text-tx transition hover:bg-elev aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          <Plus aria-hidden className="size-3.5" />
          Add
        </button>
        {refusal !== null ? (
          <p
            id={reasonId}
            role={refused ? 'alert' : undefined}
            className={cn('text-[11px] leading-4', refused ? 'text-gold' : 'text-faint')}
          >
            {refusal}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// The pool renders dozens of these; a draft change must re-render only the tiles it touches.
export const PoolTile = memo(PoolTileImpl);
