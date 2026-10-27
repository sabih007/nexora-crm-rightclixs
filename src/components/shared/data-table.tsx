'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/misc';
import { useDebouncedCallback } from '@/lib/hooks';
import { cn } from '@/lib/utils';

/**
 * Table primitive used by every list view.
 *
 * Responsive strategy: at `md` and up it renders a real `<table>` with sticky
 * headers; below that each row collapses into a labelled card so nothing is
 * clipped or needs horizontal scrolling on a phone.
 *
 * Sorting, filtering and pagination are *server-driven* — this component
 * reports intent through callbacks and never slices data itself, so a list of
 * 50,000 invoices stays fast.
 */

export interface Column<T> {
  id: string;
  header: React.ReactNode;
  /** Cell renderer. */
  cell: (row: T) => React.ReactNode;
  /** Enables the sort control on this column; value is the server sort key. */
  sortKey?: string;
  align?: 'left' | 'right' | 'center';
  /** Hide below the md breakpoint (the card layout shows it as a labelled row). */
  className?: string;
  headerClassName?: string;
  /** Omit this column from the mobile card entirely. */
  hideOnMobile?: boolean;
  /** Short label used in the mobile card layout; falls back to `header`. */
  mobileLabel?: string;
  width?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  /** Clicking a row navigates here (renders the row as a link target). */
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
  emptyAction?: React.ReactNode;
  sort?: { key: string; direction: 'asc' | 'desc' };
  onSortChange?: (key: string, direction: 'asc' | 'desc') => void;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange?: (size: number) => void;
  };
  toolbar?: React.ReactNode;
  caption?: string;
  className?: string;
  /** Rendered beneath the last row, e.g. a totals row. */
  footer?: React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  onRowClick,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  sort,
  onSortChange,
  pagination,
  toolbar,
  caption,
  className,
  footer,
}: DataTableProps<T>) {
  function toggleSort(key: string) {
    if (!onSortChange) return;
    const nextDirection = sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange(key, nextDirection);
  }

  if (loading) {
    return (
      <div className={className}>
        {toolbar ? <div className="mb-3">{toolbar}</div> : null}
        <SkeletonTable rows={6} cols={Math.min(columns.length, 6)} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={className}>
        {toolbar ? <div className="mb-3">{toolbar}</div> : null}
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      </div>
    );
  }

  return (
    <div className={className}>
      {toolbar ? <div className="mb-3">{toolbar}</div> : null}

      {/* Desktop / tablet: real table semantics */}
      <div className="border-line bg-surface hidden overflow-hidden rounded-xl border md:block">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <thead>
              <tr className="border-line bg-surface-sunken/60 border-b">
                {columns.map((col) => {
                  const activeSort = sort && sort.key === col.sortKey ? sort : null;
                  return (
                    <th
                      key={col.id}
                      scope="col"
                      style={col.width ? { width: col.width } : undefined}
                      aria-sort={
                        activeSort
                          ? activeSort.direction === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : undefined
                      }
                      className={cn(
                        'text-ink-subtle px-3 py-2.5 text-[11px] font-semibold tracking-wide uppercase',
                        col.align === 'right' && 'text-right',
                        col.align === 'center' && 'text-center',
                        col.align !== 'right' && col.align !== 'center' && 'text-left',
                        col.headerClassName,
                      )}
                    >
                      {col.sortKey && onSortChange ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col.sortKey as string)}
                          className={cn(
                            'hover:text-ink inline-flex items-center gap-1 rounded transition-colors',
                            col.align === 'right' && 'flex-row-reverse',
                            activeSort && 'text-ink',
                          )}
                        >
                          {col.header}
                          {activeSort ? (
                            activeSort.direction === 'asc' ? (
                              <ArrowUp className="size-3" aria-hidden />
                            ) : (
                              <ArrowDown className="size-3" aria-hidden />
                            )
                          ) : (
                            <span className="inline-block size-3 opacity-0 group-hover:opacity-40" />
                          )}
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-line border-b transition-colors last:border-0',
                    onRowClick && 'hover:bg-surface-hover cursor-pointer',
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={cn(
                        'text-ink px-3 py-2.5 align-middle',
                        col.align === 'right' && 'text-right',
                        col.align === 'center' && 'text-center',
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {footer ? (
              <tfoot className="border-line bg-surface-sunken/60 border-t">{footer}</tfoot>
            ) : null}
          </table>
        </div>
      </div>

      {/* Mobile: labelled cards, no clipping */}
      <ul className="space-y-2 md:hidden">
        {rows.map((row) => {
          const [primary, ...rest] = columns.filter((c) => !c.hideOnMobile);
          return (
            <li key={rowKey(row)}>
              <div
                role={onRowClick ? 'button' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                className={cn(
                  'border-line bg-surface rounded-xl border p-3.5 shadow-xs',
                  onRowClick && 'hover:bg-surface-hover cursor-pointer transition-colors',
                )}
              >
                {primary ? (
                  <div className="text-ink mb-2 text-sm font-medium">{primary.cell(row)}</div>
                ) : null}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                  {rest.map((col) => (
                    <React.Fragment key={col.id}>
                      <dt className="text-ink-subtle">{col.mobileLabel ?? col.header}</dt>
                      <dd className="text-ink text-right">{col.cell(row)}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </div>
            </li>
          );
        })}
      </ul>

      {pagination ? <Pagination {...pagination} /> : null}
    </div>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: NonNullable<DataTableProps<unknown>['pagination']>) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className="text-ink-muted mt-3 flex flex-col items-center justify-between gap-3 text-[13px] sm:flex-row"
    >
      <p>
        Showing <span className="text-ink tabular font-medium">{first}</span>–
        <span className="text-ink tabular font-medium">{last}</span> of{' '}
        <span className="text-ink tabular font-medium">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        {onPageSizeChange ? (
          <>
            <label htmlFor="page-size" className="sr-only">
              Rows per page
            </label>
            <Select
              id="page-size"
              value={String(pageSize)}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-8 w-auto text-[13px]"
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </Select>
          </>
        ) : null}
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="tabular px-1">
          {page} / {totalPages}
        </span>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Next page"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}

/**
 * Debounced search box used in table toolbars.
 *
 * The input owns its text; `onChange` fires after the debounce. The parent's
 * `value` is only the initial text, which keeps typing responsive and avoids
 * a render-time round trip through the server on every keystroke.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
  delay = 300,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  delay?: number;
}) {
  const [local, setLocal] = React.useState(value);
  const emit = useDebouncedCallback(onChange, delay);

  function handleChange(next: string) {
    setLocal(next);
    emit(next);
  }

  return (
    <div className={cn('relative', className)}>
      <Search
        className="text-ink-subtle pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        type="search"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pr-8 pl-8"
      />
      {local ? (
        <button
          type="button"
          onClick={() => {
            setLocal('');
            onChange('');
          }}
          aria-label="Clear search"
          className="text-ink-subtle hover:text-ink absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** Toolbar shell: search on the left, filters and actions on the right. */
export function TableToolbar({
  children,
  right,
  className,
}: {
  children?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}
