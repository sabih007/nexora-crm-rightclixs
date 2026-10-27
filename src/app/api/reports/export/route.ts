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
import { type ReportDocument, renderReportPdf, reportToCsvRows } from '@/features/reports/pdf';
import { getReceivablesAging } from '@/features/invoices/queries';
import { isDateRangePreset, resolveDateRange } from '@/lib/dates';

export const dynamic = 'force-dynamic';

/**
 * Report export, as CSV (`?format=csv`, the default) or PDF (`?format=pdf`).
 *
 * One document containing each section, with the calculation definitions and
 * the exchange-rate disclosures included as rows — so the exported file is
 * self-describing rather than a bare grid of numbers whose provenance is
 * lost the moment it leaves the app. Both formats are built from the same
 * `ReportDocument`, so they cannot drift apart.
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
  const format = url.searchParams.get('format') === 'pdf' ? 'pdf' : 'csv';

  const canSeeFinance = roleHasPermission(ctx.role, 'report:read_office_finance');

  const [report, aging, clients, projects] = await Promise.all([
    getFinancialReport(ctx, range),
    canSeeFinance ? getReceivablesAging(ctx) : Promise.resolve([]),
    getClientRevenue(ctx, range),
    getProjectPerformance(ctx, range),
  ]);

  const summaryMetrics = [
    ['Cash collected', report.cashCollected],
    ['Invoiced revenue', report.invoicedRevenue],
    ['Expenses paid', report.actualExpenses],
    ['Outstanding receivable', report.outstandingReceivable],
    ['Overdue receivable', report.overdueReceivable],
  ] as const;

  const byCurrencyRows: (string | number)[][] = [];
  for (const [label, metric] of [
    ['Cash collected', report.cashCollected],
    ['Invoiced revenue', report.invoicedRevenue],
    ['Expenses paid', report.actualExpenses],
  ] as const) {
    for (const [currency, amount] of Object.entries(metric.byCurrency)) {
      byCurrencyRows.push([label, currency, amount]);
    }
  }

  const agingRows: (string | number)[][] = [];
  for (const bucket of aging) {
    const entries = Object.entries(bucket.amountsByCurrency);
    if (entries.length === 0) {
      agingRows.push([bucket.label, bucket.count, '', '0']);
    } else {
      for (const [currency, amount] of entries) {
        agingRows.push([bucket.label, bucket.count, currency, amount]);
      }
    }
  }

  const document: ReportDocument = {
    title: 'Nexora OS management report',
    subtitle: `${range.label} · ${range.from.toISOString().slice(0, 10)} to ${range.to
      .toISOString()
      .slice(0, 10)} · base currency ${report.baseCurrency}`,
    meta: [
      ['Generated', new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'],
      ['Period', range.label],
      ['From', range.from.toISOString().slice(0, 10)],
      ['To', range.to.toISOString().slice(0, 10)],
      ['Base currency', report.baseCurrency],
    ],
    disclaimer:
      'Management reporting only. Not certified financial statements. Amounts in other currencies are converted using dated exchange-rate snapshots; anything without a rate is excluded and listed below.',
    sections: [
      {
        title: 'Summary',
        header: ['Metric', `Value (${report.baseCurrency})`, 'Count', 'Definition', 'Conversion'],
        weights: [1.1, 0.8, 0.4, 2.1, 1.6],
        numericColumns: [1, 2],
        rows: [
          ...summaryMetrics.map(([label, metric]) => [
            label,
            metric.value,
            metric.count,
            metric.definition,
            metric.note,
          ]),
          [
            'Net cash movement',
            report.netCashPosition.value,
            '',
            report.netCashPosition.definition,
            report.netCashPosition.incomplete
              ? 'Incomplete: unconverted amounts excluded.'
              : 'Complete.',
          ],
        ],
      },
      {
        title: 'Amounts by original currency',
        notes: [
          'Original transaction amounts, never converted. These are the authoritative figures.',
        ],
        header: ['Metric', 'Currency', 'Amount'],
        weights: [1.4, 0.6, 1],
        numericColumns: [2],
        rows: byCurrencyRows,
      },
      ...(canSeeFinance
        ? [
            {
              title: 'Receivables aging',
              header: ['Bucket', 'Invoices', 'Currency', 'Outstanding'],
              weights: [1.2, 0.6, 0.6, 1],
              numericColumns: [1, 3],
              rows: agingRows,
              emptyText: 'Nothing outstanding.',
            },
          ]
        : []),
      {
        title: 'Revenue by client',
        header: ['Client', 'Currency', 'Invoices', 'Invoiced', 'Collected', 'Outstanding'],
        weights: [2, 0.6, 0.6, 1, 1, 1],
        numericColumns: [2, 3, 4, 5],
        rows: clients.map((row) => [
          row.name,
          row.currency,
          row.invoiceCount,
          row.invoiced,
          row.collected,
          row.outstanding,
        ]),
      },
      {
        title: 'Project performance',
        notes: ['Margin is invoiced minus recorded expenses. It excludes staff time and overhead.'],
        header: [
          'Project',
          'Client',
          'Status',
          'Currency',
          'Budget',
          'Invoiced',
          'Expenses',
          'Margin',
          'Tasks %',
        ],
        weights: [1.8, 1.4, 0.8, 0.6, 0.9, 0.9, 0.9, 0.9, 0.7],
        numericColumns: [4, 5, 6, 7, 8],
        rows: projects.map((row) => [
          row.name,
          row.clientName ?? '',
          row.status,
          row.currency,
          row.budget ?? '',
          row.invoiced,
          row.expenses,
          row.margin,
          row.taskCompletion,
        ]),
      },
    ],
  };

  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorId: ctx.user.id,
    action: 'report.exported',
    entityType: 'Report',
    summary: `Management report exported (${format.toUpperCase()}) for ${range.label}`,
  });

  const stem = `nexora-report-${range.from.toISOString().slice(0, 10)}-to-${range.to
    .toISOString()
    .slice(0, 10)}`;

  if (format === 'pdf') {
    const pdf = await renderReportPdf(document);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${stem}.pdf"`,
        'Content-Length': String(pdf.byteLength),
        'Cache-Control': 'private, no-store',
      },
    });
  }

  const csv = toCsv(reportToCsvRows(document));

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${stem}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
