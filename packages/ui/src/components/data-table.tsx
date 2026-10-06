import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Direction } from 'radix-ui';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from './button.js';
import { Input } from './fields.js';

export interface DataColumn<T> {
  id: string;
  header: string;
  accessor: (row: T) => string | number;
  cell?: (row: T) => ReactNode;
  size?: number;
  sortable?: boolean;
}
export interface DataTableProps<T> {
  label: string;
  data: T[];
  columns: readonly DataColumn<T>[];
  getRowId: (row: T) => string;
  height?: number;
  virtualized?: boolean;
  direction?: 'ltr' | 'rtl';
}
function scalarCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  return JSON.stringify(value);
}

export function DataTable<T>({
  label,
  data,
  columns,
  getRowId,
  height = 360,
  virtualized = true,
  direction,
}: DataTableProps<T>) {
  // TanStack's mutable table API cannot be memoized by React Compiler.
  'use no memo';
  const resolvedDirection = Direction.useDirection(direction);
  const { t, i18n } = useTranslation();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState('');
  const [allRows, setAllRows] = useState(!virtualized);
  const scroll = useRef<HTMLDivElement>(null);
  const definitions = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((column) => ({
        id: column.id,
        header: column.header,
        accessorFn: column.accessor,
        size: column.size ?? 180,
        minSize: 80,
        maxSize: 1000,
        enableSorting: column.sortable !== false,
        cell: (info) =>
          column.cell ? column.cell(info.row.original) : scalarCell(info.getValue()),
      })),
    [columns],
  );
  // TanStack Table exposes mutable getters; this component opts out of compiler memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: definitions,
    getRowId,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    globalFilterFn: (row, columnId, value: unknown) =>
      scalarCell(row.getValue(columnId))
        .toLocaleLowerCase(i18n.language)
        .includes(scalarCell(value).toLocaleLowerCase(i18n.language)),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    columnResizeMode: 'onChange',
    columnResizeDirection: resolvedDirection,
  });
  const rows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 44,
    overscan: 8,
    enabled: !allRows,
    getItemKey: (index) => rows[index]?.id ?? index,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const rendered = allRows
    ? rows.map((row, index) => ({ row, index }))
    : virtualRows.flatMap((item) => {
        const row = rows[item.index];
        return row ? [{ row, index: item.index }] : [];
      });
  const first = virtualRows[0];
  const last = virtualRows.at(-1);
  const paddingTop = allRows ? 0 : (first?.start ?? 0);
  const paddingBottom = allRows ? 0 : Math.max(0, virtualizer.getTotalSize() - (last?.end ?? 0));
  return (
    <div className="vb-data-table" dir={resolvedDirection}>
      <div className="vb-table-toolbar">
        <Input
          label={t('ui.tableFilter')}
          type="search"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            scroll.current?.scrollTo({ top: 0 });
          }}
        />
        <span className="vb-description" role="status">
          {t('ui.tableCount', { count: rows.length })}
        </span>
        {virtualized && (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={allRows}
            onClick={() => {
              setAllRows(!allRows);
            }}
          >
            {t(allRows ? 'ui.virtualRows' : 'ui.showAllRows')}
          </Button>
        )}
      </div>
      <div
        ref={scroll}
        className="vb-table-scroll"
        style={{ maxBlockSize: height }}
        // Keyboard focus makes the overflow region scrollable without a pointer.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        role="region"
        aria-label={label}
      >
        <table
          className="vb-table"
          aria-label={label}
          aria-rowcount={rows.length + 1}
          style={{ inlineSize: table.getTotalSize() }}
        >
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} aria-rowindex={1}>
                {group.headers.map((header) => (
                  <th
                    scope="col"
                    key={header.id}
                    style={{ inlineSize: header.getSize() }}
                    aria-sort={
                      header.column.getIsSorted() === 'asc'
                        ? 'ascending'
                        : header.column.getIsSorted() === 'desc'
                          ? 'descending'
                          : 'none'
                    }
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="vb-table-sort"
                        onClick={header.column.getToggleSortingHandler()}
                        aria-label={t('ui.sortColumn', {
                          name: String(header.column.columnDef.header),
                        })}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' ? (
                          <ArrowUp size={14} aria-hidden />
                        ) : header.column.getIsSorted() === 'desc' ? (
                          <ArrowDown size={14} aria-hidden />
                        ) : (
                          <ArrowUpDown size={14} aria-hidden />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                    <button
                      type="button"
                      role="slider"
                      aria-orientation="horizontal"
                      tabIndex={0}
                      aria-label={t('ui.resizeColumn', {
                        name: String(header.column.columnDef.header),
                      })}
                      aria-valuenow={header.getSize()}
                      aria-valuemin={80}
                      aria-valuemax={1000}
                      className="vb-column-resize"
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onDoubleClick={() => {
                        header.column.resetSize();
                      }}
                      onKeyDown={(event) => {
                        const delta =
                          event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0;
                        if (delta) {
                          event.preventDefault();
                          table.setColumnSizing((current) => ({
                            ...current,
                            [header.column.id]: Math.min(
                              1000,
                              Math.max(
                                80,
                                header.getSize() + (resolvedDirection === 'rtl' ? -delta : delta),
                              ),
                            ),
                          }));
                        }
                        if (event.key === 'Home') {
                          event.preventDefault();
                          header.column.resetSize();
                        }
                      }}
                    />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr aria-hidden>
                <td colSpan={columns.length} style={{ blockSize: paddingTop, padding: 0 }} />
              </tr>
            )}
            {rendered.map(({ row, index }) => (
              <tr
                key={row.id}
                data-index={index}
                ref={allRows ? undefined : virtualizer.measureElement}
                aria-rowindex={index + 2}
                style={{ blockSize: 44 }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} style={{ inlineSize: cell.column.getSize() }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {paddingBottom > 0 && (
              <tr aria-hidden>
                <td colSpan={columns.length} style={{ blockSize: paddingBottom, padding: 0 }} />
              </tr>
            )}
            {!rows.length && (
              <tr>
                <td colSpan={columns.length} className="vb-table-empty">
                  {t('ui.tableEmpty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
