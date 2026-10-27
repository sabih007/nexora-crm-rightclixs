'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CreditCard, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/misc';
import { StatusBadge, statusOptions } from '@/components/shared/status-badge';
import { type Column, DataTable, SearchInput, TableToolbar } from '@/components/shared/data-table';
import { CurrencyAmount } from '@/components/shared/currency-amount';
import type { SubscriptionListRow } from './queries';
import type { SubscriptionFilters, SubscriptionSortKey } from './schemas';
import { CADENCES } from './schemas';
import { cadenceLabel, CADENCE_LABELS, type Cadence } from './forecast';
import type { PaginatedResult } from '@/lib/query';
import { daysUntil, formatDate } from '@/lib/dates';
import { CURRENCIES } from '@/lib/money';
import { cn, withSearchParams } from '@/lib/utils';

export function SubscriptionsTable({
  data,
  filters,
  sort,
  cards,
  platforms,
  categories,
  canCreate,
}: {
  data: PaginatedResult<SubscriptionListRow>;
  filters: SubscriptionFilters;
  sort: { key: SubscriptionSortKey; direction: 'asc' | 'desc' };
  cards: { id: string; nickname: string; last4: string }[];
  platforms: { id: string; name: string }[];
  categories: string[];
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

  const columns: Column<SubscriptionListRow>[] = [
    {
      id: 'plan',
      header: 'Subscription',
      sortKey: 'planName',
      cell: (row) => (
        <div className="min-w-0">
          <Link
            href={`/subscriptions/${row.id}`}
            className="block truncate font-medium text-ink hover:text-brand-500 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.platform.name}
          </Link>
          <span className="block truncate text-xs text-ink-subtle">{row.planName}</span>
        </div>
      ),
    },
    {
      id: 'card',
      header: 'Card',
      cell: (row) =>
        row.card ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-ink-muted">
            <CreditCard className="size-3.5 text-ink-subtle" aria-hidden />
            <span className="font-mono">···· {row.card.last4}</span>
            <span className="truncate text-xs text-ink-subtle">{row.card.nickname}</span>
          </span>
        ) : (
          <span className="text-ink-subtle">No card linked</span>
        ),
    },
    {
      id: 'amount',
      header: 'Amount',
      sortKey: 'amount',
      align: 'right',
      cell: (row) => (
        <div className="text-right">
          <CurrencyAmount amount={row.amount} currency={row.currency} className="font-medium" />
          <span className="block text-[11px] text-ink-subtle">
            {cadenceLabel(row.cadence as Cadence, row.intervalDays)}
          </span>
        </div>
      ),
    },
    {
      id: 'monthly',
      header: 'Monthly eq.',
      align: 'right',
      mobileLabel: 'Monthly equivalent',
      cell: (row) => (
        <Tooltip
          content={`${cadenceLabel(row.cadence as Cadence, row.intervalDays)} charge expressed as a per-month figure for comparison. It is a forecast, not a payment.`}
        >
          <span>
            <CurrencyAmount amount={row.monthlyEquivalent} currency={row.currency} muted />
          </span>
        </Tooltip>
      ),
    },
    {
      id: 'nextCharge',
      header: 'Next charge',
      sortKey: 'nextChargeAt',
      align: 'right',
      cell: (row) => {
        if (!['ACTIVE', 'TRIAL'].includes(row.status)) {
          return <span className="text-ink-subtle">—</span>;
        }
        const days = daysUntil(row.nextChargeAt);
        const imminent = days >= 0 && days <= 7;
        return (
          <div className="text-right">
            <span
              className={cn(
                'whitespace-nowrap text-[13px]',
                imminent ? 'font-medium text-warning' : 'text-ink-muted',
              )}
            >
              {formatDate(row.nextChargeAt)}
            </span>
            {row.cancelBy && daysUntil(row.cancelBy) >= 0 && daysUntil(row.cancelBy) <= 14 ? (
              <Tooltip
                content={`Notice period is ${row.noticeDays} days — cancel by ${formatDate(row.cancelBy)} to avoid the next charge.`}
              >
                <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-danger">
                  <AlertTriangle className="size-3" aria-hidden />
                  cancel by {formatDate(row.cancelBy, 'dd MMM')}
                </span>
              </Tooltip>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge kind="subscription" value={row.status} />
          {!row.autoRenew ? <Badge tone="outline">No auto-renew</Badge> : null}
        </div>
      ),
    },
    {
      id: 'category',
      header: 'Category',
      sortKey: 'category',
      cell: (row) => <Badge tone="outline">{row.category}</Badge>,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={data.rows}
      rowKey={(row) => row.id}
      loading={pending}
      onRowClick={(row) => router.push(`/subscriptions/${row.id}`)}
      caption="Subscriptions"
      emptyTitle={filters.search ? 'No subscriptions match' : 'No subscriptions yet'}
      emptyDescription={
        filters.search
          ? 'Try a different term or clear the filters.'
          : 'Record a subscription to forecast recurring spend and track which card pays for it.'
      }
      emptyAction={
        canCreate && !filters.search ? (
          <Button asChild>
            <Link href="/subscriptions/new">
              <Plus /> New subscription
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
            placeholder="Search platform or plan…"
            className="w-full sm:w-52"
          />

          <Select
            aria-label="Filter by card"
            value={filters.cardId}
            onChange={(e) => update({ cardId: e.target.value || null })}
            className="h-9 w-auto max-w-48"
          >
            <option value="">All cards</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nickname} ···· {c.last4}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Filter by platform"
            value={filters.platformId}
            onChange={(e) => update({ platformId: e.target.value || null })}
            className="h-9 w-auto max-w-44"
          >
            <option value="">All platforms</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Filter by status"
            value={filters.status[0] ?? ''}
            onChange={(e) => update({ status: e.target.value || null })}
            className="h-9 w-auto"
          >
            <option value="">All statuses</option>
            {statusOptions('subscription').map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Filter by billing frequency"
            value={filters.cadence[0] ?? ''}
            onChange={(e) => update({ cadence: e.target.value || null })}
            className="h-9 w-auto"
          >
            <option value="">Any frequency</option>
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {CADENCE_LABELS[c]}
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

          {categories.length > 0 ? (
            <Select
              aria-label="Filter by category"
              value={filters.category}
              onChange={(e) => update({ category: e.target.value || null })}
              className="h-9 w-auto max-w-40"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          ) : null}

          <Select
            aria-label="Filter by renewal window"
            value={filters.dueWithinDays?.toString() ?? ''}
            onChange={(e) => update({ dueWithinDays: e.target.value || null })}
            className="h-9 w-auto"
          >
            <option value="">Any renewal date</option>
            <option value="7">Due in 7 days</option>
            <option value="30">Due in 30 days</option>
            <option value="90">Due in 90 days</option>
          </Select>
        </TableToolbar>
      }
    />
  );
}
