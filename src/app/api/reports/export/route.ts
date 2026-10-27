import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/session';
import { roleHasPermission } from '@/lib/permissions';
import { recordAudit } from '@/lib/audit';
import { toCsv } from '@/lib/file-safety';
import { RATE_LIMITS, rateLimit } from '@/lib/rate-limit';
import {
  getClientRevenue,
  getFinancialReport,
  getProjectPerformance,
} from '@/features/reports/queries';
import { getReceivablesAging } from '@/features/invoices/queries';
import { isDateRangePreset, resolveDateRange } from '@/lib/dates';

export const dynamic = 'force-dynamic';

/**
 * Report CSV export.
 *
 * One document containing each section, with the calculation definitions and
 * the exchange-rate disclosures included as rows — so the exported file is
 * self-describing rather than a bare grid of numbers whose provenance is
 * lost the moment it leaves the app.
 */
export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleHasPermission(ctx.role, 'report:export')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const limit = await rateLimit(ctx.user.id, RATE_LIMITS.export);
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Too many exports. Try again shortly.' }, { status: 429 });
  }

  const url = new URL(request.url);
  const presetParam = url.searchParams.get('range') ?? 'this_year';
  const preset = isDateRangePreset(presetParam) ? presetParam : 'this_year';
  const range = resolveDateRange(preset, {
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  });

  const canSeeFinance = roleHasPermission(ctx.role, 'report:read_office_finance');

  const [report, aging, clients, projects] = await Promise.all([
    getFinancialReport(ctx, range),
    canSeeFinance ? getReceivablesAging(ctx) : Promise.resolve([]),
    getClientRevenue(ctx, range),
    getProjectPerformance(ctx, range),
  ]);

  const rows: unknown[][] = [];

  rows.push(['Nexora OS management report']);
  rows.push(['Generated', new Date().toISOString()]);
  rows.push(['Period', range.label, range.from.toISOString().slice(0, 10), range.to.toISOString().slice(0, 10)]);
  rows.push(['Base currency', report.baseCurrency]);
  rows.push(['Note', 'Management reporting only. Not certified financial statements.']);
  rows.push([]);

  rows.push(['SUMMARY']);
  rows.push(['Metric', `Value (${report.baseCurrency})`, 'Count', 'Definition', 'Conversion note']);
  for (const [label, metric] of [
    ['Cash collected', report.cashCollected],
    ['Invoiced revenue', report.invoicedRevenue],
    ['Expenses paid', report.actualExpenses],
    ['Outstanding receivable', report.outstandingReceivable],
    ['Overdue receivable', report.overdueReceivable],
  ] as const) {
    rows.push([label, metric.value, metric.count, metric.definition, metric.note]);
  }
  rows.push([
    'Net cash movement',
    report.netCashPosition.value,
    '',
    report.netCashPosition.definition,
    report.netCashPosition.incomplete ? 'Incomplete: unconverted amounts excluded.' : '',
  ]);
  rows.push([]);

  rows.push(['AMOUNTS BY ORIGINAL CURRENCY']);
  rows.push(['Metric', 'Currency', 'Amount']);
  for (const [label, metric] of [
    ['Cash collected', report.cashCollected],
    ['Invoiced revenue', report.invoicedRevenue],
    ['Expenses paid', report.actualExpenses],
  ] as const) {
    for (const [currency, amount] of Object.entries(metric.byCurrency)) {
      rows.push([label, currency, amount]);
    }
  }
  rows.push([]);

  if (aging.length > 0) {
    rows.push(['RECEIVABLES AGING']);
    rows.push(['Bucket', 'Invoices', 'Currency', 'Outstanding']);
    for (const bucket of aging) {
      const entries = Object.entries(bucket.amountsByCurrency);
      if (entries.length === 0) {
        rows.push([bucket.label, bucket.count, '', '0']);
      } else {
        for (const [currency, amount] of entries) {
          rows.push([bucket.label, bucket.count, currency, amount]);
        }
      }
    }
    rows.push([]);
  }

  rows.push(['REVENUE BY CLIENT']);
  rows.push(['Client', 'Currency', 'Invoices', 'Invoiced', 'Collected', 'Outstanding']);
  for (const row of clients) {
    rows.push([row.name, row.currency, row.invoiceCount, row.invoiced, row.collected, row.outstanding]);
  }
  rows.push([]);

  rows.push(['PROJECT PERFORMANCE']);
  rows.push([
    'Project', 'Client', 'Status', 'Currency', 'Budget', 'Invoiced', 'Expenses', 'Margin', 'Tasks complete %',
  ]);
  rows.push([
    'Note', 'Margin is invoiced minus recorded expenses. It excludes staff time and overhead.',
  ]);
  for (const row of projects) {
    rows.push([
      row.name,
      row.clientName ?? '',
      row.status,
      row.currency,
      row.budget ?? '',
      row.invoiced,
      row.expenses,
      row.margin,
      row.taskCompletion,
    ]);
  }

  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorId: ctx.user.id,
    action: 'report.exported',
    entityType: 'Report',
    summary: `Management report exported for ${range.label}`,
  });

  const csv = toCsv(rows);
  const filename = `nexora-report-${range.from.toISOString().slice(0, 10)}-to-${range.to.toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
