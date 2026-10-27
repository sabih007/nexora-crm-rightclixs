'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Download, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Checkbox } from '@/components/ui/misc';
import { StatusBadge, statusOptions } from '@/components/shared/status-badge';
import { type Column, DataTable, SearchInput, TableToolbar } from '@/components/shared/data-table';
import { CurrencyAmount } from '@/components/shared/currency-amount';
import type { InvoiceListRow } from './queries';
import type { InvoiceFilters, InvoiceSortKey } from './schemas';
import type { PaginatedResult } from '@/lib/query';
import { daysUntil, formatDate } from '@/lib/dates';
import { CURRENCIES } from '@/lib/money';
import { cn, withSearchParams } from '@/lib/utils';

export function InvoicesTable({
  data,
  filters,
  sort,
  clients,
  canCreate,
  canExport,
}: {
  data: PaginatedResult<InvoiceListRow> & { totalsByCurrency: Record<string, string> };
  filters: InvoiceFilters;
  sort: { key: InvoiceSortKey; direction: 'asc' | 'desc' };
  clients: { id: string; name: string }[];
  canCreate: boolean;
  canExport: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const update = React.useCallback(
    (changes: Record<string, string | number | null | undefined>, resetPage = true) => {
      const next = withSearchParams(searchParams, {
        ...changes,
        ...(resetPage ? { page: null } : {}),
      });
      startTransition(() => router.push(`${pathname}${next}`, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  const columns: Column<InvoiceListRow>[] = [
    {
      id: 'number',
      header: 'Invoice',
      sortKey: 'invoiceNumber',
      cell: (row) => (
        <div className="min-w-0">
          <Link
            href={`/invoices/${row.id}`}
            className="block font-mono text-[13px] font-medium text-ink hover:text-brand-500 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.invoiceNumber}
          </Link>
          <span className="block truncate text-xs text-ink-subtle">{row.client.name}</span>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (row) => <StatusBadge kind="invoice" value={row.status} />,
    },
    {
      id: 'issueDate',
      header: 'Issued',
      sortKey: 'issueDate',
      cell: (row) => <span className="text-ink-muted">{formatDate(row.issueDate)}</span>,
    },
    {
      id: 'dueDate',
      header: 'Due',
      sortKey: 'dueDate',
      cell: (row) => {
        const overdue =
          row.status === 'OVERDUE' ||
          (daysUntil(row.dueDate) < 0 &&
            ['SENT', 'PARTIALLY_PAID'].includes(row.status));
        return (
          <span className={cn('whitespace-nowrap', overdue ? 'font-medium text-danger' : 'text-ink-muted')}>
            {formatDate(row.dueDate)}
          </span>
        );
      },
    },
    {
      id: 'total',
      header: 'Total',
      sortKey: 'grandTotal',
      align: 'right',
      cell: (row) => <CurrencyAmount amount={row.grandTotal} currency={row.currency} />,
    },
    {
      id: 'balance',
      header: 'Balance',
      align: 'right',
      cell: (row) =>
        Number(row.balance) > 0 ? (
          <CurrencyAmount
            amount={row.balance}
            currency={row.currency}
            className="font-medium"
            tone={row.status === 'OVERDUE' ? 'negative' : undefined}
          />
        ) : (
          <span className="text-success">Settled</span>
        ),
    },
  ];

  const exportHref = `/api/invoices/export${withSearchParams(searchParams, {})}`;
  const totalEntries = Object.entries(data.totalsByCurrency);

  return (
    <>
      {totalEntries.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[13px]">
          <span className="text-ink-subtle">Issued total in view:</span>
          {totalEntries.map(([currency, amount]) => (
            <span key={currency} className="font-medium text-ink">
              <CurrencyAmount amount={amount} currency={currency} />
            </span>
          ))}
          <span className="text-[11px] text-ink-subtle">
            Each currency is shown separately — unlike currencies are never added together.
          </span>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={data.rows}
        rowKey={(row) => row.id}
        loading={pending}
        onRowClick={(row) => router.push(`/invoices/${row.id}`)}
        caption="Invoices"
        emptyTitle={filters.search ? 'No invoices match your search' : 'No invoices yet'}
        emptyDescription={
          filters.search
            ? 'Try a different term or clear the filters.'
            : 'Raise your first invoice to start tracking receivables.'
        }
        emptyAction={
          canCreate && !filters.search ? (
            <Button asChild>
              <Link href="/invoices/new">
                <Plus /> New invoice
              </Link>
            </Button>
          ) : null
        }
        sort={sort}
        onSortChange={(key, direction) => update({ sort: `${key}:${direction}` })}
        pagination={{
          page: data.page,
          pageSize: data.pageSize,
          total: data.total,
          onPageChange: (page) => update({ page }, false),
          onPageSizeChange: (pageSize) => update({ pageSize }),
        }}
        toolbar={
          <TableToolbar
            right={
              canExport ? (
                <Button variant="secondary" size="sm" asChild>
                  <a href={exportHref}>
                    <Download /> Export CSV
                  </a>
                </Button>
              ) : null
            }
          >
            <SearchInput
              value={filters.search}
              onChange={(value) => update({ search: value })}
              placeholder="Search number or client…"
              className="w-full sm:w-56"
            />

            <Select
              aria-label="Filter by status"
              value={filters.status[0] ?? ''}
              onChange={(e) => update({ status: e.target.value || null })}
              className="h-9 w-auto"
            >
              <option value="">All statuses</option>
              {statusOptions('invoice').map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>

            <Select
              aria-label="Filter by client"
              value={filters.clientId}
              onChange={(e) => update({ clientId: e.target.value || null })}
              className="h-9 w-auto max-w-44"
            >
              <option value="">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>

            <Select
              aria-label="Filter by currency"
              value={filters.currency}
              onChange={(e) => update({ currency: e.target.value || null })}
              className="h-9 w-auto"
            >
              <option value="">All currencies</option>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </Select>

            <label className="flex items-center gap-1.5 text-[13px] text-ink-muted">
              <span className="sr-only">Issued from</span>
              <Input
                type="date"
                value={filters.from}
                onChange={(e) => update({ from: e.target.value || null })}
                aria-label="Issued from"
                className="h-9 w-auto"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[13px] text-ink-muted">
              <span className="sr-only">Issued to</span>
              <Input
                type="date"
                value={filters.to}
                onChange={(e) => update({ to: e.target.value || null })}
                aria-label="Issued to"
                className="h-9 w-auto"
              />
            </label>

            <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-muted">
              <Checkbox
                checked={filters.unpaidOnly}
                onCheckedChange={(checked) => update({ unpaidOnly: checked ? '1' : null })}
              />
              Unpaid only
            </label>
          </TableToolbar>
        }
      />
    </>
  );
}
