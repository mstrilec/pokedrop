'use client';

import { useVirtualizer, useWindowVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { useDocumentTop, useElementWidth, useOffsetWithin } from './layout-metrics';

const GAP = 16;
// A tile is 5:7 art over a 37 px footer.
const FOOTER = 37;

type GridProps<T> = {
  items: T[];
  getKey: (item: T) => string;
  renderTile: (item: T) => ReactNode;
  label: string;
  minTileWidth?: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  /** Virtualize inside this scrolling element instead of the window (the deck builder's pool). */
  scrollElement?: HTMLElement | null;
};

type Layout = { columns: number; tileWidth: number; rowCount: number };

// What the row renderer needs from either virtualizer.
type Rows = {
  getVirtualItems: () => VirtualItem[];
  getTotalSize: () => number;
  measure: () => void;
  measureElement: (element: HTMLDivElement | null) => void;
  options: { scrollMargin: number };
};

function useLayout(
  container: RefObject<HTMLDivElement | null>,
  minTileWidth: number,
  count: number,
): Layout {
  const width = useElementWidth(container);
  const columns = Math.max(1, Math.floor((width + GAP) / (minTileWidth + GAP)));
  const tileWidth = width > 0 ? (width - GAP * (columns - 1)) / columns : minTileWidth;
  return { columns, tileWidth, rowCount: Math.ceil(count / columns) };
}

const rowSize = (layout: Layout) => (layout.tileWidth * 7) / 5 + FOOTER + GAP;

export function VirtualCardGrid<T>(props: GridProps<T>) {
  return props.scrollElement ? (
    <ElementGrid {...props} scroller={props.scrollElement} />
  ) : (
    <WindowGrid {...props} />
  );
}

function WindowGrid<T>(props: GridProps<T>) {
  const container = useRef<HTMLDivElement>(null);
  const layout = useLayout(container, props.minTileWidth ?? 150, props.items.length);
  const top = useDocumentTop(container);
  const virtualizer = useWindowVirtualizer({
    count: layout.rowCount,
    estimateSize: () => rowSize(layout),
    overscan: 3,
    scrollMargin: top,
  });
  return <GridRows {...props} container={container} layout={layout} rows={virtualizer} />;
}

function ElementGrid<T>(props: GridProps<T> & { scroller: HTMLElement }) {
  const container = useRef<HTMLDivElement>(null);
  const layout = useLayout(container, props.minTileWidth ?? 150, props.items.length);
  const top = useOffsetWithin(container, props.scroller);
  // eslint-disable-next-line react-hooks/incompatible-library -- the React Compiler is not enabled here
  const virtualizer = useVirtualizer({
    count: layout.rowCount,
    getScrollElement: () => props.scroller,
    estimateSize: () => rowSize(layout),
    overscan: 3,
    scrollMargin: top,
  });
  return <GridRows {...props} container={container} layout={layout} rows={virtualizer} />;
}

function GridRows<T>({
  items,
  getKey,
  renderTile,
  label,
  hasMore,
  loadingMore,
  onLoadMore,
  container,
  layout,
  rows: virtualizer,
}: GridProps<T> & { container: RefObject<HTMLDivElement | null>; layout: Layout; rows: Rows }) {
  const { columns, rowCount } = layout;
  const rows = virtualizer.getVirtualItems();
  const lastRendered = rows.at(-1)?.index ?? -1;

  useEffect(() => {
    if (hasMore && !loadingMore && rowCount > 0 && lastRendered >= rowCount - 3) onLoadMore();
  }, [hasMore, loadingMore, rowCount, lastRendered, onLoadMore]);

  // The column count changes the rows' heights: measure them again.
  useEffect(() => {
    virtualizer.measure();
  }, [columns, virtualizer]);

  const margin = virtualizer.options.scrollMargin;

  return (
    <div
      ref={container}
      role="list"
      aria-label={label}
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {rows.map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          className="absolute inset-x-0 top-0 grid"
          style={{
            transform: `translateY(${row.start - margin}px)`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: GAP,
            paddingBottom: GAP,
          }}
        >
          {items.slice(row.index * columns, row.index * columns + columns).map((item) => (
            <div key={getKey(item)} role="listitem">
              {renderTile(item)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
