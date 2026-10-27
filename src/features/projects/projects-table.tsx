'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Checkbox, AvatarGroup, Progress } from '@/components/ui/misc';
import { StatusBadge, statusOptions } from '@/components/shared/status-badge';
import { type Column, DataTable, SearchInput, TableToolbar } from '@/components/shared/data-table';
import { CurrencyAmount } from '@/components/shared/currency-amount';
import type { ProjectListRow } from './queries';
import type { ProjectFilters, ProjectSortKey } from './schemas';
import type { PaginatedResult } from '@/lib/query';
import { daysUntil, formatDate } from '@/lib/dates';
import { withSearchParams } from '@/lib/utils';
import { cn } from '@/lib/utils';

export function ProjectsTable({
  data,
  filters,
  sort,
  clients,
  members,
  canCreate,
}: {
  data: PaginatedResult<ProjectListRow>;
  filters: ProjectFilters;
  sort: { key: ProjectSortKey; direction: 'asc' | 'desc' };
  clients: { id: string; name: string }[];
  members: { id: string; name: string }[];
  canCreate: boolean;
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

  const columns: Column<ProjectListRow>[] = [
    {
      id: 'name',
      header: 'Project',
      sortKey: 'name',
      cell: (row) => (
        <div className="min-w-0">
          <Link
            href={`/projects/${row.id}`}
            className="text-ink hover:text-brand-500 block truncate font-medium hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.name}
          </Link>
          <span className="text-ink-subtle block truncate text-xs">
            {row.code ? <span className="font-mono">{row.code}</span> : null}
            {row.code && row.client ? ' · ' : null}
            {row.client?.name ?? (row.client === null && !row.code ? 'Internal' : null)}
          </span>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (row) => <StatusBadge kind="project" value={row.status} />,
    },
    {
      id: 'priority',
      header: 'Priority',
      sortKey: 'priority',
      cell: (row) => <StatusBadge kind="priority" value={row.priority} />,
    },
    {
      id: 'progress',
      header: 'Progress',
      cell: (row) => {
        const pct = row.taskCount === 0 ? 0 : (row.doneTaskCount / row.taskCount) * 100;
        return (
          <div className="min-w-24">
            <Progress
              value={pct}
              tone={pct === 100 ? 'success' : 'brand'}
              label={`${row.doneTaskCount} of ${row.taskCount} tasks complete`}
            />
            <span className="text-ink-subtle tabular mt-1 block text-[11px]">
              {row.doneTaskCount}/{row.taskCount} tasks
            </span>
          </div>
        );
      },
    },
    {
      id: 'team',
      header: 'Team',
      cell: (row) =>
        row.members.length > 0 ? (
          <AvatarGroup people={row.members} max={4} />
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      id: 'budget',
      header: 'Budget',
      align: 'right',
      cell: (row) =>
        row.budgetAmount ? (
          <CurrencyAmount amount={row.budgetAmount} currency={row.currency} />
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      id: 'dueDate',
      header: 'Due',
      sortKey: 'dueDate',
      align: 'right',
      cell: (row) => {
        if (!row.dueDate) return <span className="text-ink-subtle">—</span>;
        const days = daysUntil(row.dueDate);
        const overdue = days < 0 && !['COMPLETED', 'CANCELLED'].includes(row.status);
        const soon = days >= 0 && days <= 7 && !['COMPLETED', 'CANCELLED'].includes(row.status);
        return (
          <span
            className={cn(
              'text-[13px] whitespace-nowrap',
              overdue && 'text-danger font-medium',
              soon && 'text-warning font-medium',
              !overdue && !soon && 'text-ink-muted',
            )}
            title={overdue ? `${Math.abs(days)} days overdue` : undefined}
          >
            {formatDate(row.dueDate)}
          </span>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={data.rows}
      rowKey={(row) => row.id}
      loading={pending}
      onRowClick={(row) => router.push(`/projects/${row.id}`)}
      caption="Projects"
      emptyTitle={filters.search ? 'No projects match your search' : 'No projects yet'}
      emptyDescription={
        filters.search
          ? 'Try a different term or clear the filters.'
          : 'Create a project to organise tasks, files and budgets.'
      }
      emptyAction={
        canCreate && !filters.search ? (
          <Button asChild>
            <Link href="/projects/new">
              <Plus /> New project
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
        <TableToolbar>
          <SearchInput
            value={filters.search}
            onChange={(value) => update({ search: value })}
            placeholder="Search projects…"
            className="w-full sm:w-60"
          />

          <Select
            aria-label="Filter by status"
            value={filters.status[0] ?? ''}
            onChange={(e) => update({ status: e.target.value || null })}
            className="h-9 w-auto"
          >
            <option value="">All statuses</option>
            {statusOptions('project').map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Filter by priority"
            value={filters.priority[0] ?? ''}
            onChange={(e) => update({ priority: e.target.value || null })}
            className="h-9 w-auto"
          >
            <option value="">All priorities</option>
            {statusOptions('priority').map((o) => (
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
            aria-label="Filter by owner"
            value={filters.ownerId}
            onChange={(e) => update({ ownerId: e.target.value || null })}
            className="h-9 w-auto max-w-40"
          >
            <option value="">All owners</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>

          <label className="text-ink-muted flex cursor-pointer items-center gap-1.5 text-[13px]">
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
