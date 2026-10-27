'use client';

import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ComposedChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Callout } from '@/components/ui/empty-state';
import { statusLabel } from '@/components/shared/status-badge';
import { formatMoney } from '@/lib/money';

/**
 * Recharts types a tooltip value as `ValueType | undefined`. These helpers
 * narrow it once rather than casting at every call site.
 */
function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Dashboard charts.
 *
 * Deliberately restrained: three readable charts rather than a wall of
 * dials. Colours come from the design tokens so both themes work, every
 * chart has an accessible text summary beneath it, and no chart is the only
 * place a number appears — the KPI tiles above carry the audited figures.
 */

const SERIES_COLORS = {
  collected: '#0F9D58',
  invoiced: '#315CFD',
  expenses: '#B45309',
} as const;

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#9AA8C2',
  SENT: '#0EA5E9',
  PARTIALLY_PAID: '#B45309',
  PAID: '#0F9D58',
  OVERDUE: '#D1333F',
  VOID: '#76839A',
  CANCELLED: '#76839A',
  PLANNING: '#9AA8C2',
  ACTIVE: '#315CFD',
  ON_HOLD: '#B45309',
  COMPLETED: '#0F9D58',
};

const CATEGORY_COLORS = [
  '#315CFD',
  '#0EA5E9',
  '#0F9D58',
  '#B45309',
  '#7C3AED',
  '#DB2777',
  '#0E7490',
  '#C2410C',
];

interface SeriesPoint {
  month: string;
  label: string;
  collected: number;
  invoiced: number;
  expenses: number;
}

export function DashboardCharts({
  series,
  baseCurrency,
  invoiceStatusCounts,
  expensesByCategory,
  projectStatusCounts,
  seriesIncomplete,
}: {
  series: SeriesPoint[];
  baseCurrency: string;
  invoiceStatusCounts: { status: string; count: number }[];
  expensesByCategory: { category: string; amount: number }[];
  projectStatusCounts: { status: string; count: number }[];
  seriesIncomplete: boolean;
}) {
  const compact = React.useCallback(
    (value: number) => formatMoney(value, baseCurrency, { compact: true }),
    [baseCurrency],
  );

  const hasSeriesData = series.some(
    (p) => p.collected > 0 || p.invoiced > 0 || p.expenses > 0,
  );

  return (
    <div className="space-y-4">
      {seriesIncomplete ? (
        <Callout tone="warning">
          Some transactions could not be converted to {baseCurrency} and are omitted from these
          charts. The KPI tiles above state exactly what was excluded.
        </Callout>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Cash, invoiced revenue and expenses</CardTitle>
            <p className="mt-0.5 text-xs text-ink-subtle">
              Bars are money in and out; the line is what was invoiced, which is not the same as
              what was collected.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {!hasSeriesData ? (
            <p className="py-10 text-center text-sm text-ink-subtle">
              No financial activity in the last 12 months yet.
            </p>
          ) : (
            <>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: 'var(--ink-subtle)' }}
                      axisLine={{ stroke: 'var(--line)' }}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={compact}
                      tick={{ fontSize: 11, fill: 'var(--ink-subtle)' }}
                      axisLine={false}
                      tickLine={false}
                      width={64}
                    />
                    <RechartsTooltip
                      formatter={(value, name) => [
                        formatMoney(toNumber(value), baseCurrency),
                        String(name),
                      ]}
                      contentStyle={{
                        background: 'var(--surface-raised)',
                        border: '1px solid var(--line)',
                        borderRadius: 8,
                        fontSize: 12,
                        color: 'var(--ink)',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      dataKey="collected"
                      name="Cash collected"
                      fill={SERIES_COLORS.collected}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={28}
                    />
                    <Bar
                      dataKey="expenses"
                      name="Expenses paid"
                      fill={SERIES_COLORS.expenses}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={28}
                    />
                    <Line
                      type="monotone"
                      dataKey="invoiced"
                      name="Invoiced"
                      stroke={SERIES_COLORS.invoiced}
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Accessible equivalent of the chart. */}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-ink-subtle hover:text-ink">
                  View this chart as a table
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <caption className="sr-only">
                      Cash collected, expenses paid and invoiced revenue by month in{' '}
                      {baseCurrency}
                    </caption>
                    <thead>
                      <tr className="border-b border-line text-left text-ink-subtle">
                        <th scope="col" className="py-1 pr-3">Month</th>
                        <th scope="col" className="py-1 pr-3 text-right">Collected</th>
                        <th scope="col" className="py-1 pr-3 text-right">Invoiced</th>
                        <th scope="col" className="py-1 text-right">Expenses</th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.map((point) => (
                        <tr key={point.month} className="border-b border-line last:border-0">
                          <td className="py-1 pr-3 text-ink">{point.month}</td>
                          <td className="py-1 pr-3 text-right tabular text-ink-muted">
                            {formatMoney(point.collected, baseCurrency)}
                          </td>
                          <td className="py-1 pr-3 text-right tabular text-ink-muted">
                            {formatMoney(point.invoiced, baseCurrency)}
                          </td>
                          <td className="py-1 text-right tabular text-ink-muted">
                            {formatMoney(point.expenses, baseCurrency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <StatusDonut
          title="Invoices by status"
          data={invoiceStatusCounts.map((s) => ({
            name: statusLabel('invoice', s.status),
            value: s.count,
            color: STATUS_COLORS[s.status] ?? '#9AA8C2',
          }))}
          unitLabel="invoices"
        />

        <StatusDonut
          title="Projects by status"
          data={projectStatusCounts.map((s) => ({
            name: statusLabel('project', s.status),
            value: s.count,
            color: STATUS_COLORS[s.status] ?? '#9AA8C2',
          }))}
          unitLabel="projects"
        />

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Expenses by category</CardTitle>
              <p className="mt-0.5 text-xs text-ink-subtle">
                Actual spend in the selected period, in its original currency.
              </p>
            </div>
          </CardHeader>
          <CardContent>
            {expensesByCategory.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-subtle">
                No expenses recorded in this period.
              </p>
            ) : (
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[...expensesByCategory].sort((a, b) => b.amount - a.amount).slice(0, 7)}
                    layout="vertical"
                    margin={{ top: 0, right: 8, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
                    <XAxis
                      type="number"
                      tickFormatter={compact}
                      tick={{ fontSize: 10, fill: 'var(--ink-subtle)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="category"
                      tick={{ fontSize: 11, fill: 'var(--ink-subtle)' }}
                      axisLine={false}
                      tickLine={false}
                      width={92}
                    />
                    <RechartsTooltip
                      formatter={(value) => formatMoney(toNumber(value), baseCurrency)}
                      contentStyle={{
                        background: 'var(--surface-raised)',
                        border: '1px solid var(--line)',
                        borderRadius: 8,
                        fontSize: 12,
                        color: 'var(--ink)',
                      }}
                    />
                    <Bar dataKey="amount" radius={[0, 3, 3, 0]} maxBarSize={18}>
                      {expensesByCategory.map((entry, index) => (
                        <Cell
                          key={entry.category}
                          fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatusDonut({
  title,
  data,
  unitLabel,
}: {
  title: string;
  data: { name: string; value: number; color: string }[];
  unitLabel: string;
}) {
  const total = data.reduce((acc, d) => acc + d.value, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="py-8 text-center text-sm text-ink-subtle">Nothing to show yet.</p>
        ) : (
          <div className="flex items-center gap-3">
            <div className="h-36 w-36 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={38}
                    outerRadius={62}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {data.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(value, name) => [`${toNumber(value)} ${unitLabel}`, String(name)]}
                    contentStyle={{
                      background: 'var(--surface-raised)',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      fontSize: 12,
                      color: 'var(--ink)',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <ul className="min-w-0 flex-1 space-y-1 text-xs">
              {data
                .filter((d) => d.value > 0)
                .map((entry) => (
                  <li key={entry.name} className="flex items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: entry.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-ink-muted">{entry.name}</span>
                    <span className="tabular font-medium text-ink">{entry.value}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
