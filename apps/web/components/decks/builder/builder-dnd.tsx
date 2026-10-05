'use client';

import {
  type Active,
  type Announcements,
  type CollisionDetection,
  DndContext,
  DragOverlay,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { PlayableCard } from '@pokedrop/shared';
import { type ReactNode, useState } from 'react';
import { CardArt } from '@/components/cards/card-art';
import { cardView } from '@/components/cards/card-data';
import { addRefusal } from '@/components/decks/deck-rules';
import { countIn, useDeckDraft } from '@/lib/stores/deck-draft';
import { cn } from '@/lib/utils';

export const POOL_ZONE = 'pool';
export const DECK_ZONE = 'deck';
type Zone = typeof POOL_ZONE | typeof DECK_ZONE;

export type DragData = { from: Zone; card: PlayableCard; available?: number };

const ZONE_NAMES: Record<Zone, string> = { pool: 'the pool', deck: 'the deck' };

const INSTRUCTIONS =
  'To pick up a card, press Space or Enter. Use the left and right arrow keys to move between the pool and the deck. Press Space or Enter again to drop it, or Escape to cancel.';

const dataOf = (active: Active) => active.data.current as DragData;

const copies = (n: number) => `${n} ${n === 1 ? 'copy' : 'copies'}`;

// The keyboard moves a card between the two zones only: right to the deck, left to the pool.
const jumpBetweenZones: KeyboardCoordinateGetter = (event, { context }) => {
  if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') return undefined;
  event.preventDefault();
  const rect = context.droppableRects.get(event.code === 'ArrowRight' ? DECK_ZONE : POOL_ZONE);
  return rect ? { x: rect.left + 16, y: rect.top + 16 } : undefined;
};

const collision: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);

export function BuilderDnd({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const cards = useDeckDraft((s) => s.draft.cards);
  const cardsById = useDeckDraft((s) => s.cardsById);
  const add = useDeckDraft((s) => s.add);
  const remove = useDeckDraft((s) => s.remove);
  const [active, setActive] = useState<DragData | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: jumpBetweenZones }),
  );

  // What a drop does, in words and in deed; the announcement and the handler share it.
  const outcome = (data: DragData, over: string | null) => {
    const { name, id } = data.card;
    const count = countIn(cards, id);
    if (data.from === POOL_ZONE && over === DECK_ZONE) {
      const refusal = addRefusal(data.card, cards, cardsById);
      return refusal
        ? { act: null, text: `${refusal}; nothing added` }
        : { act: 'add' as const, text: `Added ${name} — ${copies(count + 1)} in the deck` };
    }
    if (data.from === DECK_ZONE && over === POOL_ZONE) {
      return {
        act: 'remove' as const,
        text:
          count <= 1
            ? `Removed ${name} from the deck`
            : `Removed a copy of ${name} — ${count - 1} left`,
      };
    }
    return { act: null, text: `${name} is back where it was; the deck is unchanged` };
  };

  const announcements: Announcements = {
    onDragStart: ({ active: dragged }) => {
      const data = dataOf(dragged);
      const way =
        data.from === POOL_ZONE ? 'right to move it to the deck' : 'left to move it to the pool';
      return `Picked up ${data.card.name} from ${ZONE_NAMES[data.from]}. Arrow ${way}, Space to drop, Escape to cancel.`;
    },
    // A drag starts over its own zone; saying so would cut the pick-up instructions short.
    onDragOver: ({ active: dragged, over }) => {
      if (over?.id === dataOf(dragged).from) return undefined;
      return over ? `Over ${ZONE_NAMES[over.id as Zone]}` : 'Not over a drop area';
    },
    onDragEnd: ({ active: dragged, over }) =>
      outcome(dataOf(dragged), over ? String(over.id) : null).text,
    onDragCancel: () => 'Cancelled; the deck is unchanged',
  };

  if (!enabled) return <>{children}</>;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}
      onDragStart={({ active: dragged }) => setActive(dataOf(dragged))}
      onDragCancel={() => setActive(null)}
      onDragEnd={({ active: dragged, over }) => {
        setActive(null);
        const data = dataOf(dragged);
        const { act } = outcome(data, over ? String(over.id) : null);
        if (act === 'add') add(data.card, data.available);
        if (act === 'remove') remove(data.card.id);
      }}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="w-24 overflow-hidden rounded-tile border border-pri shadow-lg">
            <div className="relative aspect-[5/7]">
              <CardArt card={cardView(active.card)} sizes="96px" />
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export function DropZone({
  id,
  label,
  className,
  onElement,
  children,
}: {
  id: Zone;
  label: string;
  className?: string;
  onElement?: (element: HTMLElement | null) => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id });
  const fromElsewhere =
    active !== null && (active.data.current as DragData | undefined)?.from !== id;
  return (
    <section
      aria-label={label}
      ref={(element) => {
        setNodeRef(element);
        onElement?.(element);
      }}
      className={cn(
        className,
        isOver && fromElsewhere && 'bg-pri-dim outline-2 outline-pri outline-dashed',
      )}
    >
      {children}
    </section>
  );
}
