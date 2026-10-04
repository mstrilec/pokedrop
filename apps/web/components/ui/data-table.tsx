'use client';

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type OnChangeFn,
  type RowData,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the generics must match TanStack's declaration
  interface ColumnMeta<TData extends RowData, TValue> {
    /** The column's grid track: `1.6fr`, `120px`, `minmax(0,1fr)`. Default `1fr`. */
    width?: string;
    /** Mono, right-aligned: coins, prices, counts. */
    numeric?: boolean;
  }
}

type DataTableProps<T> = {
  // TanStack's column type is invariant in its value type; any is what its own docs use here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  data: T[];
  /** Names the table for assistive tech. */
  label: string;
  getRowId?: (row: T) => string;
  /** Pass both to own the sort (a server-sorted list); omit them and the table sorts its rows. */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  skeletonRows?: number;
  empty?: ReactNode;
  dense?: boolean;
  className?: string;
};

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;

export function DataTable<T>({
  columns,
  data,
  label,
  getRowId,
  sorting: sortingProp,
  onSortingChange,
  onRowClick,
  loading = false,
  skeletonRows = 5,
  empty,
  dense = false,
  className,
}: DataTableProps<T>) {
  const [localSorting, setLocalSorting] = useState<SortingState>([]);
  const manual = onSortingChange !== undefined;
  // TanStack Table returns functions the React Compiler cannot memoize; it skips this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: { sorting: manual ? (sortingProp ?? []) : localSorting },
    onSortingChange: manual ? onSortingChange : setLocalSorting,
    manualSorting: manual,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const leafColumns = table.getVisibleLeafColumns();
  const template = leafColumns.map((c) => c.columnDef.meta?.width ?? '1fr').join(' ');
  const rows = table.getRowModel().rows;
  const cellPad = dense ? 'px-4 py-2' : 'px-5 py-3';

  function activate(event: KeyboardEvent<HTMLDivElement>, row: T) {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick?.(row);
    }
  }

  return (
    <div
      role="table"
      aria-label={label}
      aria-busy={loading || undefined}
      aria-rowcount={loading ? -1 : rows.length + 1}
      className={cn('overflow-hidden rounded-card border border-bd bg-surface', className)}
    >
      <div role="rowgroup">
        {table.getHeaderGroups().map((group) => (
          <div
            key={group.id}
            role="row"
            className="grid gap-3 border-b border-bd"
            style={{ gridTemplateColumns: template }}
          >
            {group.headers.map((header) => {
              const sortable = header.column.getCanSort();
              const sorted = header.column.getIsSorted();
              const numeric = header.column.columnDef.meta?.numeric;
              const title = flexRender(header.column.columnDef.header, header.getContext());
              const SortIcon =
                sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown;
              return (
                <div
                  key={header.id}
                  role="columnheader"
                  aria-sort={sortable ? (sorted ? ARIA_SORT[sorted] : 'none') : undefined}
                  className={cn(
                    'text-caption text-faint uppercase',
                    cellPad,
                    numeric && 'text-right',
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        'focus-ring -mx-1 inline-flex cursor-pointer items-center gap-1 rounded-tag px-1 uppercase hover:text-tx',
                        sorted && 'text-tx',
                      )}
                    >
                      {title}
                      <SortIcon aria-hidden className="size-3" />
                    </button>
                  ) : (
                    title
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div role="rowgroup">
        {loading ? (
          Array.from({ length: skeletonRows }, (_, i) => (
            <div
              key={i}
              role="row"
              aria-hidden
              className="grid gap-3 border-b border-bd last:border-b-0"
              style={{ gridTemplateColumns: template }}
            >
              {leafColumns.map((c) => (
                <div key={c.id} className={cellPad}>
                  <Skeleton width={c.columnDef.meta?.numeric ? '60%' : '80%'} />
                </div>
              ))}
            </div>
          ))
        ) : rows.length === 0 ? (
          <div role="row">
            <div role="cell" className="p-8 text-center text-small text-mut">
              {empty ?? 'Nothing here yet.'}
            </div>
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              role="row"
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              onKeyDown={onRowClick ? (event) => activate(event, row.original) : undefined}
              className={cn(
                'grid items-center gap-3 border-b border-bd transition-colors last:border-b-0 hover:bg-surface-2',
                onRowClick && 'focus-ring cursor-pointer',
              )}
              style={{ gridTemplateColumns: template }}
            >
              {row.getVisibleCells().map((cell) => (
                <div
                  key={cell.id}
                  role="cell"
                  className={cn(
                    'min-w-0 text-small text-tx',
                    cellPad,
                    cell.column.columnDef.meta?.numeric && 'text-right font-mono',
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
