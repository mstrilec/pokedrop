'use client';

import type { InventoryEntry, InventorySort } from '@pokedrop/shared';
import { createColumnHelper, type SortingState } from '@tanstack/react-table';
import { Lock } from 'lucide-react';
import Link from 'next/link';
import { CardArt } from '@/components/cards/card-art';
import { cardView, formatUsd, setNumber } from '@/components/cards/card-data';
import { RARITY_STYLES, rarityTier } from '@/lib/design/rarity';

const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });
const column = createColumnHelper<InventoryEntry>();

export const INVENTORY_COLUMNS = [
  column.accessor((entry) => entry.card.name, {
    id: 'card',
    header: 'Card',
    meta: { width: 'minmax(14rem, 2fr)' },
    cell: ({ row }) => {
      const entry = row.original;
      return (
        <span className="flex items-center gap-3">
          <span className="relative h-11 w-8 shrink-0 overflow-hidden rounded-tag">
            <CardArt card={cardView(entry.card)} sizes="32px" />
          </span>
          <span className="flex min-w-0 flex-col">
            <Link
              href={`/cards/${encodeURIComponent(entry.cardId)}`}
              className="focus-ring truncate rounded-tag font-semibold hover:text-pri"
            >
              {entry.card.name}
            </Link>
            <span className="font-mono text-caption text-faint">{setNumber(entry.cardId)}</span>
          </span>
        </span>
      );
    },
  }),
  column.accessor((entry) => entry.card.rarity, {
    id: 'rarity',
    header: 'Rarity',
    enableSorting: false,
    meta: { width: 'minmax(8rem, 1fr)' },
    cell: ({ getValue }) => {
      const rarity = getValue();
      return <span className={RARITY_STYLES[rarityTier(rarity)].text}>{rarity ?? '—'}</span>;
    },
  }),
  column.accessor((entry) => entry.card.types.join(', '), {
    id: 'type',
    header: 'Type',
    enableSorting: false,
    meta: { width: '7rem' },
  }),
  column.accessor('quantity', {
    id: 'copies',
    header: 'Copies',
    enableSorting: false,
    meta: { width: '9rem', numeric: true },
    cell: ({ row }) => {
      const { quantity, lockedQuantity } = row.original;
      return lockedQuantity > 0 ? (
        <span className="inline-flex items-center gap-1.5">
          {quantity} · <Lock aria-hidden className="size-3.5 text-gold" /> {lockedQuantity} locked
        </span>
      ) : (
        quantity
      );
    },
  }),
  column.accessor((entry) => entry.card.latestPriceUsd, {
    id: 'price',
    header: 'Price',
    meta: { width: '6rem', numeric: true },
    cell: ({ getValue }) => formatUsd(getValue()),
  }),
  column.accessor('acquiredAt', {
    id: 'acquired',
    header: 'Acquired',
    meta: { width: '8rem' },
    cell: ({ getValue }) => <span className="text-mut">{day.format(getValue())}</span>,
  }),
];

// The list's sortable headers drive the server's sort; the table never reorders a page itself.
const SORTS: Record<string, readonly [InventorySort, InventorySort]> = {
  card: ['name_asc', 'name_desc'],
  price: ['price_asc', 'price_desc'],
  acquired: ['acquired_asc', 'acquired_desc'],
};

export function sortingOf(sort: InventorySort): SortingState {
  for (const [id, [asc, desc]] of Object.entries(SORTS)) {
    if (sort === asc) return [{ id, desc: false }];
    if (sort === desc) return [{ id, desc: true }];
  }
  return [];
}

export function sortOf(state: SortingState): InventorySort | undefined {
  const first = state[0];
  const pair = first ? SORTS[first.id] : undefined;
  return pair && first ? (first.desc ? pair[1] : pair[0]) : undefined;
}
