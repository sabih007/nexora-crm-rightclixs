'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Building2, Download, Plus, Upload, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/field';
import { Checkbox } from '@/components/ui/misc';
import { StatusBadge, statusOptions } from '@/components/shared/status-badge';
import { Column, DataTable, SearchInput, TableToolbar } from '@/components/shared/data-table';
import type { ClientListRow } from './queries';
import type { ClientFilters, ClientSortKey } from './schemas';
import type { PaginatedResult } from '@/lib/query';
import { formatDate } from '@/lib/dates';
import { withSearchParams } from '@/lib/utils';
import { CURRENCIES } from '@/lib/money';

/**
 * Client list.
 *
 * All state lives in the URL, so a filtered view is shareable and the back
 * button behaves. Changing a filter resets to page 1.
 */
export function ClientsTable({
  data,
  filters,
  sort,
  tags,
  canCreate,
  canExport,
  canImport,
}: {
  data: PaginatedResult<ClientListRow>;
  filters: ClientFilters;
  sort: { key: ClientSortKey; direction: 'asc' | 'desc' };
  tags: string[];
  canCreate: boolean;
  canExport: boolean;
  canImport: boolean;
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

  const columns: Column<ClientListRow>[] = [
    {
      id: 'name',
      header: 'Client',
      sortKey: 'name',
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-ink-subtle"
            aria-hidden
          >
            {row.type === 'COMPANY' ? (
              <Building2 className="size-3.5" />
            ) : (
              <User className="size-3.5" />
            )}
          </span>
          <div className="min-w-0">
            <Link
              href={`/clients/${row.id}`}
              className="block truncate font-medium text-ink hover:text-brand-500 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {row.name}
            </Link>
            {row.email ? (
              <span className="block truncate text-xs text-ink-subtle">{row.email}</span>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (row) => <StatusBadge kind="client" value={row.status} />,
    },
    {
      id: 'currency',
      header: 'Currency',
      sortKey: 'billingCurrency',
      cell: (row) => <span className="tabular text-ink-muted">{row.billingCurrency}</span>,
    },
    {
      id: 'projects',
      header: 'Projects',
      align: 'right',
      cell: (row) => <span className="tabular text-ink-muted">{row.projectCount}</span>,
    },
    {
      id: 'openInvoices',
      header: 'Open invoices',
      align: 'right',
      mobileLabel: 'Open invoices',
      cell: (row) =>
        row.openInvoiceCount > 0 ? (
          <Badge tone="warning">{row.openInvoiceCount}</Badge>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      id: 'tags',
      header: 'Tags',
      cell: (row) =>
        row.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} tone="outline" size="sm">
                {tag}
              </Badge>
            ))}
            {row.tags.length > 3 ? (
              <Badge tone="outline" size="sm">
                +{row.tags.length - 3}
              </Badge>
            ) : null}
          </div>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      id: 'createdAt',
      header: 'Added',
      sortKey: 'createdAt',
      cell: (row) => <span className="text-ink-muted">{formatDate(row.createdAt)}</span>,
    },
  ];

  const exportHref = `/api/clients/export${withSearchParams(searchParams, {})}`;

  return (
    <DataTable
      columns={columns}
      rows={data.rows}
      rowKey={(row) => row.id}
      loading={pending}
      onRowClick={(row) => router.push(`/clients/${row.id}`)}
      caption="Clients"
      emptyTitle={filters.search ? 'No clients match your search' : 'No clients yet'}
      emptyDescription={
        filters.search
          ? 'Try a different search term or clear the filters.'
          : 'Add your first client to start tracking projects and invoices.'
      }
      emptyAction={
        canCreate && !filters.search ? (
          <Button asChild>
            <Link href="/clients/new">
              <Plus /> New client
            </Link>
          </Button>
        ) : null
      }
      sort={{ key: sort.key, direction: sort.direction }}
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
            <>
              {canImport ? (
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/clients/import">
                    <Upload /> Import
                  </Link>
                </Button>
              ) : null}
              {canExport ? (
                <Button variant="secondary" size="sm" asChild>
                  <a href={exportHref}>
                    <Download /> Export CSV
                  </a>
                </Button>
              ) : null}
            </>
          }
        >
          <SearchInput
            value={filters.search}
            onChange={(value) => update({ search: value })}
            placeholder="Search name, email, contact…"
            className="w-full sm:w-64"
          />

          <Select
            aria-label="Filter by status"
            value={filters.status[0] ?? ''}
            onChange={(e) => update({ status: e.target.value || null })}
            className="h-9 w-auto"
          >
            <option value="">All statuses</option>
            {statusOptions('client').map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Filter by type"
            value={filters.type[0] ?? ''}
            onChange={(e) => update({ type: e.target.value || null })}
            className="h-9 w-auto"
          >
            <option value="">All types</option>
            <option value="COMPANY">Companies</option>
            <option value="INDIVIDUAL">Individuals</option>
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

          {tags.length > 0 ? (
            <Select
              aria-label="Filter by tag"
              value={filters.tag}
              onChange={(e) => update({ tag: e.target.value || null })}
              className="h-9 w-auto"
            >
              <option value="">All tags</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </Select>
          ) : null}

          <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-muted">
            <Checkbox
              checked={filters.includeArchived}
              onCheckedChange={(checked) => update({ includeArchived: checked ? '1' : null })}
            />
            Show archived
          </label>
        </TableToolbar>
      }
    />
  );
}
