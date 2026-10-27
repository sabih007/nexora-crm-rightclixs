import Link from 'next/link';
import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState, Callout, EmptyState } from '@/components/ui/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CurrencyAmount } from '@/components/shared/currency-amount';
import { MultiCurrencyAmount } from '@/features/subscriptions/multi-currency-amount';
import { listExpenses } from '@/features/subscriptions/queries';
import { first, parsePagination } from '@/lib/query';
import { fromDateInput, formatDate } from '@/lib/dates';
import { ExpensePagination } from '@/features/subscriptions/expense-pagination';

export const metadata = { title: 'Expenses' };
export const dynamic = 'force-dynamic';

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'expense:read')) {
    return <NoAccessState what="expenses" />;
  }

  const params = await searchParams;
  const from = first(params.from);
  const to = first(params.to);
  const category = first(params.category);

  const result = await listExpenses(ctx, {
    ...(from ? { from: fromDateInput(from) } : {}),
    ...(to ? { to: fromDateInput(to) } : {}),
    ...(category ? { category } : {}),
    pagination: parsePagination(params),
  });

  return (
    <>
      <Callout tone="success" className="mb-4">
        These are <strong>actual</strong> charges that have left the account. Forecast figures on
        the Overview tab are expectations and are never counted here.
      </Callout>

      {Object.keys(result.totalsByCurrency).length > 0 ? (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-baseline justify-between gap-3 pt-4">
            <div>
              <p className="text-xs text-ink-subtle">Total paid in this view</p>
              <MultiCurrencyAmount amounts={result.totalsByCurrency} size="lg" className="mt-0.5" />
            </div>
            <p className="text-[11px] text-ink-subtle">
              {result.total} expense{result.total === 1 ? '' : 's'}, each shown in the currency it
              was paid in.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {result.rows.length === 0 ? (
        <EmptyState
          title="No expenses recorded"
          description="Record a charge from a subscription, or add a one-off expense, to build a real spend history."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-[var(--line)]">
              {result.rows.map((expense) => (
                <li key={expense.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                  <span className="w-24 shrink-0 text-sm text-ink">
                    {formatDate(expense.paidAt)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{expense.description}</p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-subtle">
                      <Badge tone="outline" size="sm">
                        {expense.category}
                      </Badge>
                      {expense.subscription ? (
                        <Link
                          href={`/subscriptions/${expense.subscription.id}`}
                          className="hover:text-brand-500 hover:underline"
                        >
                          {expense.subscription.platform.name}
                        </Link>
                      ) : null}
                      {expense.client ? (
                        <Link
                          href={`/clients/${expense.client.id}`}
                          className="hover:text-brand-500 hover:underline"
                        >
                          {expense.client.name}
                        </Link>
                      ) : null}
                      {expense.reference ? <span>ref {expense.reference}</span> : null}
                      <span>by {expense.createdBy.name}</span>
                    </p>
                  </div>
                  <CurrencyAmount
                    amount={expense.amount.toString()}
                    currency={expense.currency}
                    className="font-medium"
                  />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ExpensePagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />

      {!can(ctx, 'expense:create') ? null : (
        <p className="mt-4 text-xs text-ink-subtle">
          Record a subscription charge from its detail page to add it here automatically.
        </p>
      )}
    </>
  );
}
