import 'server-only';
import { prisma } from '@/lib/db';
import type { AuthContext } from '@/lib/auth/session';
import { clientScopeWhere, projectScopeWhere } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { Decimal, dec, roundMoney, sum } from '@/lib/money';
import { addDays, todayUtc } from '@/lib/dates';
import { outstandingBalance } from '@/features/invoices/calculations';
import {
  allSubscriptionsForForecast,
  getForecastSummary,
} from '@/features/subscriptions/queries';
import { commitmentTotals } from '@/features/subscriptions/forecast';
import { consolidate, describeConsolidation, type RateRecord } from './exchange';

/**
 * Reporting.
 *
 * Every figure here is computed from source records at query time — there
 * are no cached aggregates to drift. Each metric carries a plain-language
 * `definition` so a reader can see exactly what was counted, and the three
 * distinctions the specification insists on are preserved throughout:
 *
 *   • cash collected   ≠ invoiced revenue
 *   • forecast cost    ≠ actual paid expense
 *   • original currency amounts are never silently summed across currencies
 */

export interface Metric {
  /** Consolidated total in the workspace base currency. */
  value: string;
  baseCurrency: string;
  /** Per-currency original amounts, before conversion. */
  byCurrency: Record<string, string>;
  definition: string;
  /** Rate disclosure, or a note about what was excluded. */
  note: string;
  incomplete: boolean;
  count: number;
}

async function loadRates(): Promise<RateRecord[]> {
  const rates = await prisma.exchangeRate.findMany({
    orderBy: { effectiveDate: 'desc' },
    take: 2000,
  });
  return rates.map((r) => ({
    baseCurrency: r.baseCurrency,
    quoteCurrency: r.quoteCurrency,
    rate: r.rate.toString(),
    effectiveDate: r.effectiveDate,
    source: r.source,
  }));
}

function buildMetric(
  items: { amount: string; currency: string; date: Date }[],
  baseCurrency: string,
  rates: RateRecord[],
  definition: string,
): Metric {
  const consolidated = consolidate(items, baseCurrency, rates);

  const byCurrency: Record<string, Decimal> = {};
  for (const item of items) {
    byCurrency[item.currency] = (byCurrency[item.currency] ?? new Decimal(0)).plus(
      dec(item.amount),
    );
  }

  return {
    value: consolidated.total,
    baseCurrency,
    byCurrency: Object.fromEntries(
      Object.entries(byCurrency).map(([c, v]) => [c, roundMoney(v, c).toString()]),
    ),
    definition,
    note: describeConsolidation(consolidated),
    incomplete: consolidated.incomplete,
    count: items.length,
  };
}

export interface ReportRange {
  from: Date;
  to: Date;
  label: string;
}

export interface FinancialReport {
  range: ReportRange;
  baseCurrency: string;
  cashCollected: Metric;
  invoicedRevenue: Metric;
  actualExpenses: Metric;
  outstandingReceivable: Metric;
  overdueReceivable: Metric;
  netCashPosition: {
    value: string;
    definition: string;
    incomplete: boolean;
  };
  forecastCommitment: {
    monthlyByCurrency: Record<string, string>;
    annualByCurrency: Record<string, string>;
    definition: string;
  };
}

/**
 * The core financial picture for a date range.
 *
 * `cashCollected` counts payments received in the period. `invoicedRevenue`
 * counts invoices *issued* in the period. They are different numbers and are
 * reported separately and labelled as such — a point the spec is explicit
 * about and the most common way a CRM misleads its owner.
 */
export async function getFinancialReport(
  ctx: AuthContext,
  range: ReportRange,
): Promise<FinancialReport> {
  const [workspace, rates] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { baseCurrency: true },
    }),
    loadRates(),
  ]);
  const baseCurrency = workspace.baseCurrency;

  const [payments, issuedInvoices, expenses, openInvoices, subscriptions] = await Promise.all([
    prisma.payment.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        paymentDate: { gte: range.from, lte: range.to },
      },
      select: { amount: true, currency: true, paymentDate: true },
    }),
    prisma.invoice.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        status: { notIn: ['DRAFT', 'VOID', 'CANCELLED'] },
        issueDate: { gte: range.from, lte: range.to },
      },
      select: { grandTotal: true, currency: true, issueDate: true },
    }),
    prisma.expense.findMany({
      where: { workspaceId: ctx.workspaceId, paidAt: { gte: range.from, lte: range.to } },
      select: { amount: true, currency: true, paidAt: true },
    }),
    prisma.invoice.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
      },
      select: {
        status: true,
        currency: true,
        dueDate: true,
        grandTotal: true,
        amountPaid: true,
        creditedTotal: true,
      },
    }),
    allSubscriptionsForForecast(ctx),
  ]);

  const cashCollected = buildMetric(
    payments.map((p) => ({
      amount: p.amount.toString(),
      currency: p.currency,
      date: p.paymentDate,
    })),
    baseCurrency,
    rates,
    'Payments actually received, by payment date. This is cash in hand — not what was billed.',
  );

  const invoicedRevenue = buildMetric(
    issuedInvoices.map((i) => ({
      amount: i.grandTotal.toString(),
      currency: i.currency,
      date: i.issueDate,
    })),
    baseCurrency,
    rates,
    'Grand total of invoices issued in the period, whether or not they have been paid. Drafts, voided and cancelled invoices are excluded.',
  );

  const actualExpenses = buildMetric(
    expenses.map((e) => ({
      amount: e.amount.toString(),
      currency: e.currency,
      date: e.paidAt,
    })),
    baseCurrency,
    rates,
    'Expenses recorded as actually paid in the period. Forecast subscription costs are not included.',
  );

  const today = todayUtc();

  const receivableItems = openInvoices
    .map((inv) => ({
      amount: outstandingBalance({
        grandTotal: inv.grandTotal.toString(),
        amountPaid: inv.amountPaid.toString(),
        creditedTotal: inv.creditedTotal.toString(),
        currency: inv.currency,
      }),
      currency: inv.currency,
      date: inv.dueDate,
      overdue: inv.dueDate < today,
    }))
    .filter((item) => dec(item.amount).greaterThan(0));

  const outstandingReceivable = buildMetric(
    receivableItems.map(({ amount, currency, date }) => ({ amount, currency, date })),
    baseCurrency,
    rates,
    'Unpaid balance on every issued invoice, as at today. Converted using the rate effective on each invoice due date.',
  );

  const overdueReceivable = buildMetric(
    receivableItems
      .filter((item) => item.overdue)
      .map(({ amount, currency, date }) => ({ amount, currency, date })),
    baseCurrency,
    rates,
    'The part of the outstanding balance whose due date has passed.',
  );

  const commitment = commitmentTotals(subscriptions);

  return {
    range,
    baseCurrency,
    cashCollected,
    invoicedRevenue,
    actualExpenses,
    outstandingReceivable,
    overdueReceivable,
    netCashPosition: {
      value: roundMoney(
        dec(cashCollected.value).minus(dec(actualExpenses.value)),
        baseCurrency,
      ).toString(),
      definition:
        'Cash collected minus expenses actually paid, in the period. Not profit: it ignores unpaid invoices, unbilled work and any expense not recorded here.',
      incomplete: cashCollected.incomplete || actualExpenses.incomplete,
    },
    forecastCommitment: {
      monthlyByCurrency: commitment.monthlyByCurrency,
      annualByCurrency: commitment.annualByCurrency,
      definition:
        'Expected recurring cost of active subscriptions. A forecast from each schedule — no money has been spent.',
    },
  };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface MonthlySeriesPoint {
  month: string;
  label: string;
  collected: number;
  invoiced: number;
  expenses: number;
}

/**
 * Twelve months of cash, invoiced revenue and spend, consolidated to the
 * base currency. Chart values are plain numbers — presentation only; every
 * figure a user acts on comes from the Decimal path above.
 */
export async function getMonthlySeries(
  ctx: AuthContext,
  months = 12,
): Promise<{ points: MonthlySeriesPoint[]; baseCurrency: string; incomplete: boolean }> {
  const [workspace, rates] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { baseCurrency: true },
    }),
    loadRates(),
  ]);

  const now = todayUtc();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

  const [payments, invoices, expenses] = await Promise.all([
    prisma.payment.findMany({
      where: { workspaceId: ctx.workspaceId, paymentDate: { gte: start } },
      select: { amount: true, currency: true, paymentDate: true },
    }),
    prisma.invoice.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        status: { notIn: ['DRAFT', 'VOID', 'CANCELLED'] },
        issueDate: { gte: start },
      },
      select: { grandTotal: true, currency: true, issueDate: true },
    }),
    prisma.expense.findMany({
      where: { workspaceId: ctx.workspaceId, paidAt: { gte: start } },
      select: { amount: true, currency: true, paidAt: true },
    }),
  ]);

  const buckets = new Map<string, MonthlySeriesPoint>();
  for (let i = 0; i < months; i += 1) {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    buckets.set(key, {
      month: key,
      label: date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }),
      collected: 0,
      invoiced: 0,
      expenses: 0,
    });
  }

  let incomplete = false;

  function add(
    field: 'collected' | 'invoiced' | 'expenses',
    amount: string,
    currency: string,
    date: Date,
  ) {
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const bucket = buckets.get(key);
    if (!bucket) return;

    const result = consolidate([{ amount, currency, date }], workspace.baseCurrency, rates);
    if (result.incomplete) {
      incomplete = true;
      return;
    }
    bucket[field] += Number(result.total);
  }

  for (const p of payments) add('collected', p.amount.toString(), p.currency, p.paymentDate);
  for (const i of invoices) add('invoiced', i.grandTotal.toString(), i.currency, i.issueDate);
  for (const e of expenses) add('expenses', e.amount.toString(), e.currency, e.paidAt);

  return { points: [...buckets.values()], baseCurrency: workspace.baseCurrency, incomplete };
}

export interface DashboardData {
  baseCurrency: string;
  report: FinancialReport;
  series: Awaited<ReturnType<typeof getMonthlySeries>>;
  invoiceStatusCounts: { status: string; count: number }[];
  expensesByCategory: { category: string; amount: number }[];
  projectStatusCounts: { status: string; count: number }[];
  counts: {
    activeClients: number;
    activeProjects: number;
    openInvoices: number;
    activeSubscriptions: number;
  };
  upcomingRenewals: Awaited<ReturnType<typeof getForecastSummary>>['upcoming'];
  renewalTotals: { next7: Record<string, string>; next30: Record<string, string> };
}

/** Everything the Overview page needs, in one pass. */
export async function getDashboardData(
  ctx: AuthContext,
  range: ReportRange,
): Promise<DashboardData> {
  const canSeeFinance = roleHasPermission(ctx.role, 'report:read_office_finance');

  const [report, series, invoiceStatuses, expenseGroups, projectStatuses, counts, forecast] =
    await Promise.all([
      getFinancialReport(ctx, range),
      getMonthlySeries(ctx),
      prisma.invoice.groupBy({
        by: ['status'],
        where: { workspaceId: ctx.workspaceId },
        _count: true,
      }),
      canSeeFinance
        ? prisma.expense.groupBy({
            by: ['category'],
            where: {
              workspaceId: ctx.workspaceId,
              paidAt: { gte: range.from, lte: range.to },
            },
            _sum: { amount: true },
          })
        : Promise.resolve([]),
      prisma.project.groupBy({
        by: ['status'],
        where: { ...projectScopeWhere(ctx), archivedAt: null },
        _count: true,
      }),
      Promise.all([
        prisma.client.count({ where: { ...clientScopeWhere(ctx), archivedAt: null } }),
        prisma.project.count({
          where: { ...projectScopeWhere(ctx), archivedAt: null, status: 'ACTIVE' },
        }),
        prisma.invoice.count({
          where: {
            workspaceId: ctx.workspaceId,
            status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
          },
        }),
        prisma.subscription.count({
          where: { workspaceId: ctx.workspaceId, status: { in: ['ACTIVE', 'TRIAL'] } },
        }),
      ]),
      getForecastSummary(ctx),
    ]);

  const today = todayUtc();

  return {
    baseCurrency: report.baseCurrency,
    report,
    series,
    invoiceStatusCounts: invoiceStatuses.map((g) => ({ status: g.status, count: g._count })),
    expensesByCategory: expenseGroups.map((g) => ({
      category: g.category,
      // Chart-only: the audited figure is `report.actualExpenses`.
      amount: Number((g._sum.amount ?? 0).toString()),
    })),
    projectStatusCounts: projectStatuses.map((g) => ({ status: g.status, count: g._count })),
    counts: {
      activeClients: counts[0],
      activeProjects: counts[1],
      openInvoices: counts[2],
      activeSubscriptions: counts[3],
    },
    upcomingRenewals: forecast.upcoming.filter((c) => c.chargeDate <= addDays(today, 30)),
    renewalTotals: { next7: forecast.next7, next30: forecast.next30 },
  };
}

// ---------------------------------------------------------------------------
// Client and project performance
// ---------------------------------------------------------------------------

export interface ClientRevenueRow {
  clientId: string;
  name: string;
  currency: string;
  invoiced: string;
  collected: string;
  outstanding: string;
  invoiceCount: number;
}

/** Revenue per client, in each client's own billing currency. */
export async function getClientRevenue(
  ctx: AuthContext,
  range: ReportRange,
): Promise<ClientRevenueRow[]> {
  const clients = await prisma.client.findMany({
    where: clientScopeWhere(ctx),
    select: {
      id: true,
      name: true,
      billingCurrency: true,
      invoices: {
        where: {
          status: { notIn: ['DRAFT', 'VOID', 'CANCELLED'] },
          issueDate: { gte: range.from, lte: range.to },
        },
        select: {
          currency: true,
          grandTotal: true,
          amountPaid: true,
          creditedTotal: true,
        },
      },
    },
  });

  return clients
    .filter((client) => client.invoices.length > 0)
    .map((client) => {
      // Only invoices in the client's own billing currency are summed; a
      // client billed in two currencies is reported on its primary one and
      // the Reports page discloses that.
      const relevant = client.invoices.filter((i) => i.currency === client.billingCurrency);

      const invoiced = sum(relevant.map((i) => i.grandTotal.toString()));
      const collected = sum(relevant.map((i) => i.amountPaid.toString()));
      const outstanding = sum(
        relevant.map((i) =>
          outstandingBalance({
            grandTotal: i.grandTotal.toString(),
            amountPaid: i.amountPaid.toString(),
            creditedTotal: i.creditedTotal.toString(),
            currency: i.currency,
          }),
        ),
      );

      return {
        clientId: client.id,
        name: client.name,
        currency: client.billingCurrency,
        invoiced: roundMoney(invoiced, client.billingCurrency).toString(),
        collected: roundMoney(collected, client.billingCurrency).toString(),
        outstanding: roundMoney(outstanding, client.billingCurrency).toString(),
        invoiceCount: client.invoices.length,
      };
    })
    .sort((a, b) => Number(b.invoiced) - Number(a.invoiced));
}

export interface ProjectPerformanceRow {
  projectId: string;
  name: string;
  clientName: string | null;
  status: string;
  currency: string;
  budget: string | null;
  invoiced: string;
  expenses: string;
  /** budget − invoiced, or null when no budget is set. */
  budgetRemaining: string | null;
  /** invoiced − expenses. Not profit: unbilled labour is not counted. */
  margin: string;
  taskCompletion: number;
}

/**
 * Project performance.
 *
 * Deliberately transparent about what it is not: `margin` is invoiced minus
 * recorded expenses. It does not include staff time, overhead or any cost
 * that was never entered as an expense, so it is a billing view rather than
 * a profitability statement. The Reports page says so.
 */
export async function getProjectPerformance(
  ctx: AuthContext,
  range: ReportRange,
): Promise<ProjectPerformanceRow[]> {
  const projects = await prisma.project.findMany({
    where: { ...projectScopeWhere(ctx), archivedAt: null },
    select: {
      id: true,
      name: true,
      status: true,
      currency: true,
      budgetAmount: true,
      client: { select: { name: true } },
      invoices: {
        where: {
          status: { notIn: ['DRAFT', 'VOID', 'CANCELLED'] },
          issueDate: { gte: range.from, lte: range.to },
        },
        select: { grandTotal: true, currency: true },
      },
      expenses: {
        where: { paidAt: { gte: range.from, lte: range.to } },
        select: { amount: true, currency: true },
      },
      tasks: { select: { status: true } },
    },
  });

  return projects.map((project) => {
    const invoiced = sum(
      project.invoices
        .filter((i) => i.currency === project.currency)
        .map((i) => i.grandTotal.toString()),
    );
    const expenses = sum(
      project.expenses
        .filter((e) => e.currency === project.currency)
        .map((e) => e.amount.toString()),
    );

    const doneTasks = project.tasks.filter((t) => t.status === 'DONE').length;

    return {
      projectId: project.id,
      name: project.name,
      clientName: project.client?.name ?? null,
      status: project.status,
      currency: project.currency,
      budget: project.budgetAmount?.toString() ?? null,
      invoiced: roundMoney(invoiced, project.currency).toString(),
      expenses: roundMoney(expenses, project.currency).toString(),
      budgetRemaining: project.budgetAmount
        ? roundMoney(dec(project.budgetAmount.toString()).minus(invoiced), project.currency).toString()
        : null,
      margin: roundMoney(invoiced.minus(expenses), project.currency).toString(),
      taskCompletion:
        project.tasks.length === 0 ? 0 : Math.round((doneTasks / project.tasks.length) * 100),
    };
  });
}

/** Stored exchange rates, newest first, for the Settings and Reports pages. */
export async function listExchangeRates(limit = 100) {
  return prisma.exchangeRate.findMany({
    orderBy: [{ effectiveDate: 'desc' }, { baseCurrency: 'asc' }],
    take: limit,
  });
}
