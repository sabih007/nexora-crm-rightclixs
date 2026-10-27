import Link from 'next/link';
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  FolderKanban,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { StatCard, StatGrid } from '@/components/shared/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Callout, EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/shared/status-badge';
import { CurrencyAmount } from '@/components/shared/currency-amount';
import { MultiCurrencyAmount } from '@/features/subscriptions/multi-currency-amount';
import { DashboardCharts } from '@/features/reports/dashboard-charts';
import { DateRangeControl } from '@/features/reports/date-range-control';
import { getDashboardData } from '@/features/reports/queries';
import { listMyTasks } from '@/features/projects/queries';
import { first } from '@/lib/query';
import { isDateRangePreset, resolveDateRange, formatDate, daysUntil } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Overview' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAuthPage();
  const params = await searchParams;

  const presetParam = first(params.range) ?? 'this_year';
  const preset = isDateRangePreset(presetParam) ? presetParam : 'this_year';
  const range = resolveDateRange(preset, { from: first(params.from), to: first(params.to) });

  const canSeeFinance = roleHasPermission(ctx.role, 'report:read_office_finance');
  const canSeeInvoices = roleHasPermission(ctx.role, 'invoice:read');

  const [data, myTasks] = await Promise.all([getDashboardData(ctx, range), listMyTasks(ctx, 6)]);

  const { report } = data;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Figures computed from source records for ${range.label.toLowerCase()}.`}
        actions={
          <DateRangeControl preset={preset} from={first(params.from)} to={first(params.to)} />
        }
      />

      {report.cashCollected.incomplete ||
      report.invoicedRevenue.incomplete ||
      report.actualExpenses.incomplete ? (
        <Callout tone="warning" title="Some amounts could not be converted" className="mb-4">
          One or more transactions are in a currency with no exchange rate on or before their date,
          so they are excluded from the consolidated totals below rather than being estimated. Add
          the missing rates in{' '}
          <Link href="/settings/exchange-rates" className="font-medium underline">
            Settings → Exchange rates
          </Link>
          .
        </Callout>
      ) : null}

      {canSeeFinance ? (
        <StatGrid className="mb-5">
          <StatCard
            label="Cash collected"
            definition={report.cashCollected.definition}
            value={formatMoney(report.cashCollected.value, report.baseCurrency, { compact: true })}
            sublabel={`${report.cashCollected.count} payment${report.cashCollected.count === 1 ? '' : 's'}`}
            tone="success"
            icon={Banknote}
          />
          <StatCard
            label="Invoiced revenue"
            definition={report.invoicedRevenue.definition}
            value={formatMoney(report.invoicedRevenue.value, report.baseCurrency, {
              compact: true,
            })}
            sublabel={`${report.invoicedRevenue.count} invoice${report.invoicedRevenue.count === 1 ? '' : 's'}`}
            icon={Receipt}
            href="/invoices"
          />
          <StatCard
            label="Outstanding"
            definition={report.outstandingReceivable.definition}
            value={formatMoney(report.outstandingReceivable.value, report.baseCurrency, {
              compact: true,
            })}
            sublabel={
              Number(report.overdueReceivable.value) > 0
                ? `${formatMoney(report.overdueReceivable.value, report.baseCurrency, { compact: true })} overdue`
                : 'none overdue'
            }
            tone={Number(report.overdueReceivable.value) > 0 ? 'danger' : 'default'}
            icon={AlertTriangle}
            href="/invoices?unpaidOnly=1"
          />
          <StatCard
            label="Expenses paid"
            definition={report.actualExpenses.definition}
            value={formatMoney(report.actualExpenses.value, report.baseCurrency, { compact: true })}
            sublabel={`${report.actualExpenses.count} recorded`}
            icon={Wallet}
            href="/subscriptions/expenses"
          />
        </StatGrid>
      ) : null}

      <StatGrid className="mb-5">
        <StatCard
          label="Active clients"
          definition="Clients that are not archived and that your role can see."
          value={data.counts.activeClients}
          icon={Users}
          href="/clients"
        />
        <StatCard
          label="Active projects"
          definition="Projects with status Active that your role can see."
          value={data.counts.activeProjects}
          icon={FolderKanban}
          href="/projects"
        />
        {canSeeInvoices ? (
          <StatCard
            label="Open invoices"
            definition="Issued invoices that are sent, partially paid or overdue."
            value={data.counts.openInvoices}
            icon={Receipt}
            href="/invoices?unpaidOnly=1"
          />
        ) : null}
        {can(ctx, 'subscription:read') ? (
          <StatCard
            label="Monthly commitment"
            definition={report.forecastCommitment.definition}
            value={<MultiCurrencyAmount amounts={report.forecastCommitment.monthlyByCurrency} />}
            sublabel={`${data.counts.activeSubscriptions} active`}
            icon={TrendingUp}
            href="/subscriptions"
          />
        ) : null}
      </StatGrid>

      {canSeeFinance ? (
        <div className="mb-5">
          <SectionHeader
            title="Trends"
            description={`Last 12 months, consolidated to ${data.baseCurrency} using dated exchange rates.`}
          />
          <DashboardCharts
            series={data.series.points}
            baseCurrency={data.baseCurrency}
            invoiceStatusCounts={data.invoiceStatusCounts}
            expensesByCategory={data.expensesByCategory}
            projectStatusCounts={data.projectStatusCounts}
            seriesIncomplete={data.series.incomplete}
          />
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {can(ctx, 'subscription:read') ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Renewals in the next 30 days</CardTitle>
                <p className="text-ink-subtle mt-0.5 text-xs">
                  Expected charges from each subscription&rsquo;s schedule — not payments.
                </p>
              </div>
              <Link
                href="/subscriptions/calendar"
                className="text-brand-500 shrink-0 text-xs font-medium hover:underline"
              >
                Calendar →
              </Link>
            </CardHeader>
            <CardContent>
              {data.upcomingRenewals.length === 0 ? (
                <EmptyState icon={CalendarClock} title="Nothing due in 30 days" compact />
              ) : (
                <>
                  <ul className="divide-y divide-[var(--line)]">
                    {data.upcomingRenewals.slice(0, 7).map((charge, index) => {
                      const days = daysUntil(charge.chargeDate);
                      return (
                        <li
                          key={`${charge.subscriptionId}-${index}`}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0"
                        >
                          <span
                            className={cn(
                              'w-16 shrink-0 text-xs',
                              days <= 7 ? 'text-warning font-medium' : 'text-ink-subtle',
                            )}
                          >
                            {formatDate(charge.chargeDate, 'dd MMM')}
                          </span>
                          <Link
                            href={`/subscriptions/${charge.subscriptionId}`}
                            className="text-ink hover:text-brand-500 min-w-0 flex-1 truncate text-sm hover:underline"
                          >
                            {charge.platformName}
                          </Link>
                          {charge.cardLabel ? (
                            <span className="text-ink-subtle truncate text-[11px]">
                              {charge.cardLabel}
                            </span>
                          ) : null}
                          <CurrencyAmount
                            amount={charge.amount}
                            currency={charge.currency}
                            className="font-medium"
                          />
                        </li>
                      );
                    })}
                  </ul>
                  <div className="border-line mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t pt-3 text-xs">
                    <span className="text-ink-subtle">Next 7 days:</span>
                    <MultiCurrencyAmount amounts={data.renewalTotals.next7} size="md" />
                    <span className="text-ink-subtle">Next 30 days:</span>
                    <MultiCurrencyAmount amounts={data.renewalTotals.next30} size="md" />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Your open tasks</CardTitle>
              <p className="text-ink-subtle mt-0.5 text-xs">
                Assigned to you and not yet done, soonest first.
              </p>
            </div>
          </CardHeader>
          <CardContent>
            {myTasks.length === 0 ? (
              <EmptyState title="Nothing assigned to you" compact />
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {myTasks.map((task) => {
                  const overdue = task.dueDate && daysUntil(task.dueDate) < 0;
                  return (
                    <li
                      key={task.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0"
                    >
                      <StatusBadge kind="task" value={task.status} size="sm" />
                      <Link
                        href={`/projects/${task.project.id}`}
                        className="text-ink hover:text-brand-500 min-w-0 flex-1 truncate text-sm hover:underline"
                      >
                        {task.title}
                      </Link>
                      <span className="text-ink-subtle truncate text-[11px]">
                        {task.project.name}
                      </span>
                      {task.dueDate ? (
                        <span
                          className={cn(
                            'text-xs whitespace-nowrap',
                            overdue ? 'text-danger font-medium' : 'text-ink-subtle',
                          )}
                        >
                          {formatDate(task.dueDate, 'dd MMM')}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {canSeeFinance ? (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>How these figures are calculated</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-xs sm:grid-cols-2">
              {[
                ['Cash collected', report.cashCollected],
                ['Invoiced revenue', report.invoicedRevenue],
                ['Outstanding', report.outstandingReceivable],
                ['Expenses paid', report.actualExpenses],
              ].map(([label, metric]) => {
                const m = metric as typeof report.cashCollected;
                return (
                  <div key={label as string}>
                    <dt className="text-ink font-medium">{label as string}</dt>
                    <dd className="text-ink-subtle mt-0.5">{m.definition}</dd>
                    {Object.keys(m.byCurrency).length > 1 ? (
                      <dd className="mt-1 flex flex-wrap gap-1.5">
                        {Object.entries(m.byCurrency).map(([currency, amount]) => (
                          <Badge key={currency} tone="outline" size="sm">
                            {formatMoney(amount, currency)}
                          </Badge>
                        ))}
                      </dd>
                    ) : null}
                    {m.note ? <dd className="text-ink-subtle mt-1">{m.note}</dd> : null}
                  </div>
                );
              })}
            </dl>
            <p className="border-line text-ink-subtle mt-4 border-t pt-3 text-[11px]">
              Management reporting only. These are not certified financial statements and do not
              account for tax treatment, accruals or unbilled work.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
