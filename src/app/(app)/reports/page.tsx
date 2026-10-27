import Link from 'next/link';
import { Download, FileText } from 'lucide-react';
import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState, Callout, EmptyState } from '@/components/ui/empty-state';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { StatusBadge } from '@/components/shared/status-badge';
import { CurrencyAmount } from '@/components/shared/currency-amount';
import { DateRangeControl } from '@/features/reports/date-range-control';
import {
  getClientRevenue,
  getFinancialReport,
  getProjectPerformance,
} from '@/features/reports/queries';
import { getReceivablesAging } from '@/features/invoices/queries';
import { getForecastSummary } from '@/features/subscriptions/queries';
import { MultiCurrencyAmount } from '@/features/subscriptions/multi-currency-amount';
import { first } from '@/lib/query';
import { isDateRangePreset, resolveDateRange } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { withSearchParams } from '@/lib/utils';

export const metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'report:read')) {
    return (
      <>
        <PageHeader title="Reports" />
        <NoAccessState what="reports" />
      </>
    );
  }

  const params = await searchParams;
  const presetParam = first(params.range) ?? 'this_year';
  const preset = isDateRangePreset(presetParam) ? presetParam : 'this_year';
  const range = resolveDateRange(preset, { from: first(params.from), to: first(params.to) });

  const canSeeFinance = roleHasPermission(ctx.role, 'report:read_office_finance');

  const [report, aging, clientRevenue, projectPerformance, forecast] = await Promise.all([
    getFinancialReport(ctx, range),
    canSeeFinance ? getReceivablesAging(ctx) : Promise.resolve([]),
    getClientRevenue(ctx, range),
    getProjectPerformance(ctx, range),
    can(ctx, 'subscription:read') ? getForecastSummary(ctx) : Promise.resolve(null),
  ]);

  const exportQuery = withSearchParams(new URLSearchParams(), {
    range: preset,
    from: first(params.from) ?? null,
    to: first(params.to) ?? null,
  });
  const pdfExportQuery = withSearchParams(new URLSearchParams(exportQuery), { format: 'pdf' });

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${range.label} · consolidated to ${report.baseCurrency}`}
        breadcrumbs={[{ label: 'Nexora OS', href: '/dashboard' }, { label: 'Reports' }]}
        actions={
          <>
            <DateRangeControl preset={preset} from={first(params.from)} to={first(params.to)} />
            {can(ctx, 'report:export') ? (
              <>
                <Button variant="secondary" asChild>
                  <a href={`/api/reports/export${exportQuery}`}>
                    <Download /> Export CSV
                  </a>
                </Button>
                <Button variant="secondary" asChild>
                  <a href={`/api/reports/export${pdfExportQuery}`}>
                    <FileText /> Export PDF
                  </a>
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <Callout tone="info" className="mb-5">
        <strong>Management reporting, not financial statements.</strong> Figures are computed from
        the records in this system at the moment you loaded the page. They make no allowance for tax
        treatment, accruals, unbilled work or anything not entered here.
      </Callout>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          {canSeeFinance ? <TabsTrigger value="aging">Receivables aging</TabsTrigger> : null}
          <TabsTrigger value="clients">By client</TabsTrigger>
          <TabsTrigger value="projects">By project</TabsTrigger>
          {forecast ? <TabsTrigger value="forecast">Subscription forecast</TabsTrigger> : null}
        </TabsList>

        {/* ---------------------------------------------------------------- */}
        <TabsContent value="summary" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {(
              [
                ['Cash collected', report.cashCollected, 'The money that actually arrived.'],
                ['Invoiced revenue', report.invoicedRevenue, 'What was billed, paid or not.'],
                ['Expenses paid', report.actualExpenses, 'Real spend, not forecast.'],
                [
                  'Outstanding receivable',
                  report.outstandingReceivable,
                  'Still owed to the office.',
                ],
              ] as const
            ).map(([label, metric, blurb]) => (
              <Card key={label}>
                <CardHeader>
                  <div>
                    <CardTitle>{label}</CardTitle>
                    <p className="text-ink-subtle mt-0.5 text-xs">{blurb}</p>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <CurrencyAmount amount={metric.value} currency={report.baseCurrency} size="xl" />

                  {Object.keys(metric.byCurrency).length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(metric.byCurrency).map(([currency, amount]) => (
                        <Badge key={currency} tone="outline" size="sm">
                          {formatMoney(amount, currency)}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  <p className="text-ink-subtle text-[11px] leading-relaxed">{metric.definition}</p>
                  {metric.note ? (
                    <p
                      className={
                        metric.incomplete
                          ? 'text-warning text-[11px] leading-relaxed'
                          : 'text-ink-subtle text-[11px] leading-relaxed'
                      }
                    >
                      {metric.note}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Net cash movement</CardTitle>
                <p className="text-ink-subtle mt-0.5 text-xs">
                  {report.netCashPosition.definition}
                </p>
              </div>
            </CardHeader>
            <CardContent>
              <CurrencyAmount
                amount={report.netCashPosition.value}
                currency={report.baseCurrency}
                size="xl"
                tone={Number(report.netCashPosition.value) >= 0 ? 'positive' : 'negative'}
              />
              {report.netCashPosition.incomplete ? (
                <p className="text-warning mt-1 text-[11px]">
                  Incomplete: some transactions could not be converted and are excluded.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        {canSeeFinance ? (
          <TabsContent value="aging">
            <SectionHeader
              title="Accounts receivable aging"
              description="Unpaid balances by how long they have been due, in their original currency."
            />
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Receivables aging by bucket and currency</caption>
                    <thead>
                      <tr className="border-line bg-surface-sunken/60 border-b">
                        <th
                          scope="col"
                          className="text-ink-subtle px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide uppercase"
                        >
                          Age
                        </th>
                        <th
                          scope="col"
                          className="text-ink-subtle px-4 py-2.5 text-right text-[11px] font-semibold tracking-wide uppercase"
                        >
                          Invoices
                        </th>
                        <th
                          scope="col"
                          className="text-ink-subtle px-4 py-2.5 text-right text-[11px] font-semibold tracking-wide uppercase"
                        >
                          Outstanding
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {aging.map((bucket) => (
                        <tr key={bucket.label} className="border-line border-b last:border-0">
                          <td className="text-ink px-4 py-2.5">{bucket.label}</td>
                          <td className="tabular text-ink-muted px-4 py-2.5 text-right">
                            {bucket.count}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <MultiCurrencyAmount
                              amounts={bucket.amountsByCurrency}
                              size="md"
                              emptyLabel="—"
                              className="items-end"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            <p className="text-ink-subtle mt-2 text-[11px]">
              Buckets are measured from each invoice&rsquo;s due date. Each currency is listed
              separately — aging buckets are never converted, because an ageing figure mixes dates
              and a single rate would misstate it.
            </p>
          </TabsContent>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        <TabsContent value="clients">
          <SectionHeader
            title="Revenue by client"
            description="Invoices issued in the period, in each client's billing currency."
          />
          {clientRevenue.length === 0 ? (
            <EmptyState title="No invoiced revenue in this period" />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Revenue by client</caption>
                    <thead>
                      <tr className="border-line bg-surface-sunken/60 border-b">
                        {['Client', 'Invoices', 'Invoiced', 'Collected', 'Outstanding'].map(
                          (header, index) => (
                            <th
                              key={header}
                              scope="col"
                              className={`text-ink-subtle px-4 py-2.5 text-[11px] font-semibold tracking-wide uppercase ${index === 0 ? 'text-left' : 'text-right'}`}
                            >
                              {header}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {clientRevenue.map((row) => (
                        <tr key={row.clientId} className="border-line border-b last:border-0">
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/clients/${row.clientId}`}
                              className="text-ink hover:text-brand-500 font-medium hover:underline"
                            >
                              {row.name}
                            </Link>
                          </td>
                          <td className="tabular text-ink-muted px-4 py-2.5 text-right">
                            {row.invoiceCount}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <CurrencyAmount amount={row.invoiced} currency={row.currency} />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <CurrencyAmount
                              amount={row.collected}
                              currency={row.currency}
                              tone="positive"
                            />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <CurrencyAmount
                              amount={row.outstanding}
                              currency={row.currency}
                              tone={Number(row.outstanding) > 0 ? 'negative' : undefined}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        <TabsContent value="projects">
          <SectionHeader
            title="Project performance"
            description="Billing view by project, in the project's own currency."
          />
          <Callout tone="warning" className="mb-3">
            <strong>Margin here is invoiced minus recorded expenses only.</strong> It does not
            include staff time, overhead, or any cost that was never entered as an expense, so it is
            not project profitability.
          </Callout>

          {projectPerformance.length === 0 ? (
            <EmptyState title="No projects to report on" />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Project performance</caption>
                    <thead>
                      <tr className="border-line bg-surface-sunken/60 border-b">
                        {[
                          'Project',
                          'Status',
                          'Tasks',
                          'Budget',
                          'Invoiced',
                          'Expenses',
                          'Margin',
                        ].map((header, index) => (
                          <th
                            key={header}
                            scope="col"
                            className={`text-ink-subtle px-4 py-2.5 text-[11px] font-semibold tracking-wide uppercase ${index <= 1 ? 'text-left' : 'text-right'}`}
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {projectPerformance.map((row) => (
                        <tr key={row.projectId} className="border-line border-b last:border-0">
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/projects/${row.projectId}`}
                              className="text-ink hover:text-brand-500 font-medium hover:underline"
                            >
                              {row.name}
                            </Link>
                            {row.clientName ? (
                              <span className="text-ink-subtle block text-xs">
                                {row.clientName}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusBadge kind="project" value={row.status} />
                          </td>
                          <td className="tabular text-ink-muted px-4 py-2.5 text-right">
                            {row.taskCompletion}%
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {row.budget ? (
                              <CurrencyAmount amount={row.budget} currency={row.currency} muted />
                            ) : (
                              <span className="text-ink-subtle">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <CurrencyAmount amount={row.invoiced} currency={row.currency} />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <CurrencyAmount amount={row.expenses} currency={row.currency} muted />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <CurrencyAmount
                              amount={row.margin}
                              currency={row.currency}
                              className="font-medium"
                              tone={Number(row.margin) >= 0 ? 'positive' : 'negative'}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        {forecast ? (
          <TabsContent value="forecast" className="space-y-4">
            <SectionHeader
              title="Subscription commitment"
              description="Expected recurring cost. No money has been spent — actual spend is in Expenses."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ['Monthly equivalent', forecast.commitment.monthlyByCurrency],
                  ['Annual commitment', forecast.commitment.annualByCurrency],
                  ['Due in 7 days', forecast.next7],
                  ['Due in 30 days', forecast.next30],
                ] as const
              ).map(([label, amounts]) => (
                <Card key={label}>
                  <CardContent className="pt-4">
                    <p className="text-ink-subtle text-xs">{label}</p>
                    <MultiCurrencyAmount amounts={amounts} size="lg" className="mt-1" />
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-ink-subtle text-[11px]">
              Monthly equivalent: monthly = amount, quarterly = amount ÷ 3, annual = amount ÷ 12,
              weekly = amount × 52 ÷ 12, custom = amount × (365.25 ÷ interval days) ÷ 12. Each
              currency is reported separately.
            </p>
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}
