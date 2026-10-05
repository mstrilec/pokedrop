'use client';

import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, useEffect, useRef } from 'react';
import { useDocumentTop, useElementWidth } from './layout-metrics';

const GAP = 16;
// A tile is 5:7 art over a 37 px footer.
const FOOTER = 37;

export function VirtualCardGrid<T>({
  items,
  getKey,
  renderTile,
  label,
  minTileWidth = 150,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  items: T[];
  getKey: (item: T) => string;
  renderTile: (item: T) => ReactNode;
  label: string;
  minTileWidth?: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const width = useElementWidth(container);
  const top = useDocumentTop(container);
  const columns = Math.max(1, Math.floor((width + GAP) / (minTileWidth + GAP)));
  const tileWidth = width > 0 ? (width - GAP * (columns - 1)) / columns : minTileWidth;
  const rowCount = Math.ceil(items.length / columns);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => (tileWidth * 7) / 5 + FOOTER + GAP,
    overscan: 3,
    scrollMargin: top,
  });
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
