'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/misc';
import { type Column, DataTable, SearchInput, TableToolbar } from '@/components/shared/data-table';
import { auditLabel } from '@/lib/audit-labels';
import { formatDateTime } from '@/lib/dates';
import { withSearchParams } from '@/lib/utils';

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  createdAt: Date;
  actor: { id: string; name: string; avatarColor: string } | null;
}

const ENTITY_HREF: Record<string, (id: string) => string> = {
  Client: (id) => `/clients/${id}`,
  Project: (id) => `/projects/${id}`,
  Invoice: (id) => `/invoices/${id}`,
  Subscription: (id) => `/subscriptions/${id}`,
};

/** Searchable, filterable audit trail. */
export function ActivityLog({
  entries,
  total,
  page,
  pageSize,
  filters,
  actors,
  entityTypes,
}: {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  filters: { search: string; entityType: string; actorId: string };
  actors: { id: string; name: string }[];
  entityTypes: string[];
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

  const columns: Column<AuditEntry>[] = [
    {
      id: 'when',
      header: 'When',
      cell: (row) => (
        <time
          dateTime={new Date(row.createdAt).toISOString()}
          className="whitespace-nowrap text-[13px] text-ink-muted"
        >
          {formatDateTime(row.createdAt)}
        </time>
      ),
    },
    {
      id: 'actor',
      header: 'Who',
      cell: (row) =>
        row.actor ? (
          <span className="flex items-center gap-1.5 text-[13px] text-ink">
            <Avatar name={row.actor.name} color={row.actor.avatarColor} size="xs" />
            <span className="truncate">{row.actor.name}</span>
          </span>
        ) : (
          <span className="text-[13px] text-ink-subtle">System</span>
        ),
    },
    {
      id: 'action',
      header: 'Action',
      cell: (row) => <span className="text-[13px] font-medium text-ink">{auditLabel(row.action)}</span>,
    },
    {
      id: 'entity',
      header: 'Record',
      cell: (row) => {
        const href = row.entityId ? ENTITY_HREF[row.entityType]?.(row.entityId) : undefined;
        return (
          <span className="flex items-center gap-1.5">
            <Badge tone="outline" size="sm">
              {row.entityType}
            </Badge>
            {href ? (
              <Link href={href} className="text-xs text-brand-500 hover:underline">
                open
              </Link>
            ) : null}
          </span>
        );
      },
    },
    {
      id: 'summary',
      header: 'Detail',
      cell: (row) =>
        row.summary ? (
          <span className="text-[13px] text-ink-muted">{row.summary}</span>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={entries}
      rowKey={(row) => row.id}
      loading={pending}
      caption="Activity log"
      emptyTitle="No activity recorded"
      emptyDescription="Changes to clients, invoices, payments, cards and roles appear here."
      pagination={{
        page,
        pageSize,
        total,
        onPageChange: (next) => update({ page: next }, false),
        onPageSizeChange: (size) => update({ pageSize: size }),
      }}
      toolbar={
        <TableToolbar>
          <SearchInput
            value={filters.search}
            onChange={(value) => update({ search: value })}
            placeholder="Search actions and details…"
            className="w-full sm:w-64"
          />

          <Select
            aria-label="Filter by record type"
            value={filters.entityType}
            onChange={(e) => update({ entityType: e.target.value || null })}
            className="h-9 w-auto"
          >
            <option value="">All record types</option>
            {entityTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Filter by person"
            value={filters.actorId}
            onChange={(e) => update({ actorId: e.target.value || null })}
            className="h-9 w-auto max-w-44"
          >
            <option value="">Everyone</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </Select>
        </TableToolbar>
      }
    />
  );
}
