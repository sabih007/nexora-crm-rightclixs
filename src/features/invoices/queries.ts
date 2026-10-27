import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import type { AuthContext } from '@/lib/auth/session';
import { escapeLike, type PaginatedResult, type Pagination, skipTake } from '@/lib/query';
import { fromDateInput } from '@/lib/dates';
import { dec, roundMoney, sum } from '@/lib/money';
import { outstandingBalance } from './calculations';
import type { InvoiceFilters, InvoiceSortKey } from './schemas';

/** Invoice read models. Always scoped to the actor's workspace. */

export interface InvoiceListRow {
  id: string;
  invoiceNumber: string;
  status: string;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  grandTotal: string;
  amountPaid: string;
  balance: string;
  client: { id: string; name: string };
  project: { id: string; name: string } | null;
}

function buildWhere(ctx: AuthContext, filters: InvoiceFilters): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = { workspaceId: ctx.workspaceId };
  const and: Prisma.InvoiceWhereInput[] = [];

  if (filters.search) {
    const term = escapeLike(filters.search);
    and.push({
      OR: [
        { invoiceNumber: { contains: term, mode: 'insensitive' } },
        { client: { name: { contains: term, mode: 'insensitive' } } },
        { notes: { contains: term, mode: 'insensitive' } },
      ],
    });
  }
  if (filters.status.length > 0) and.push({ status: { in: filters.status } });
  if (filters.clientId) and.push({ clientId: filters.clientId });
  if (filters.currency) and.push({ currency: filters.currency });
  if (filters.from) and.push({ issueDate: { gte: fromDateInput(filters.from) } });
  if (filters.to) and.push({ issueDate: { lte: fromDateInput(filters.to) } });
  if (filters.unpaidOnly) {
    and.push({ status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } });
  }

  if (and.length > 0) where.AND = and;
  return where;
}

const SORT_FIELDS: Record<InvoiceSortKey, keyof Prisma.InvoiceOrderByWithRelationInput> = {
  invoiceNumber: 'invoiceNumber',
  issueDate: 'issueDate',
  dueDate: 'dueDate',
  grandTotal: 'grandTotal',
  status: 'status',
};

export async function listInvoices(
  ctx: AuthContext,
  filters: InvoiceFilters,
  pagination: Pagination,
  sort: { key: InvoiceSortKey; direction: 'asc' | 'desc' },
): Promise<PaginatedResult<InvoiceListRow> & { totalsByCurrency: Record<string, string> }> {
  const where = buildWhere(ctx, filters);

  const [rows, total, grouped] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { [SORT_FIELDS[sort.key]]: sort.direction },
      ...skipTake(pagination),
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        currency: true,
        issueDate: true,
        dueDate: true,
        grandTotal: true,
        amountPaid: true,
        creditedTotal: true,
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    }),
    prisma.invoice.count({ where }),
    // Totals for the whole filtered set, grouped by currency — never summed
    // across currencies.
    prisma.invoice.groupBy({
      by: ['currency'],
      where: { ...where, status: { notIn: ['VOID', 'CANCELLED', 'DRAFT'] } },
      _sum: { grandTotal: true },
    }),
  ]);

  return {
    rows: rows.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      status: inv.status,
      currency: inv.currency,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      grandTotal: inv.grandTotal.toString(),
      amountPaid: inv.amountPaid.toString(),
      balance: outstandingBalance({
        grandTotal: inv.grandTotal.toString(),
        amountPaid: inv.amountPaid.toString(),
        creditedTotal: inv.creditedTotal.toString(),
        currency: inv.currency,
      }),
      client: inv.client,
      project: inv.project,
    })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalsByCurrency: Object.fromEntries(
      grouped.map((g) => [g.currency, (g._sum.grandTotal ?? dec(0)).toString()]),
    ),
  };
}

export async function getInvoiceDetail(ctx: AuthContext, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, workspaceId: ctx.workspaceId },
    include: {
      lines: { orderBy: { position: 'asc' } },
      client: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          taxId: true,
          addressJson: true,
          billingCurrency: true,
        },
      },
      project: { select: { id: true, name: true } },
      allocations: {
        include: {
          payment: {
            select: {
              id: true,
              amount: true,
              currency: true,
              paymentDate: true,
              method: true,
              reference: true,
              notes: true,
              createdBy: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      creditNotes: { orderBy: { issuedAt: 'desc' } },
    },
  });

  if (!invoice) return null;

  return {
    ...invoice,
    balance: outstandingBalance({
      grandTotal: invoice.grandTotal.toString(),
      amountPaid: invoice.amountPaid.toString(),
      creditedTotal: invoice.creditedTotal.toString(),
      currency: invoice.currency,
    }),
  };
}

export async function getInvoiceActivity(ctx: AuthContext, invoiceId: string, take = 25) {
  return prisma.auditLog.findMany({
    where: { workspaceId: ctx.workspaceId, entityId: invoiceId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      summary: true,
      createdAt: true,
      actor: { select: { id: true, name: true, avatarColor: true } },
    },
  });
}

/** Open invoices for a client, for the payment allocation UI. */
export async function listOpenInvoicesForClient(
  ctx: AuthContext,
  clientId: string,
  currency?: string,
) {
  const invoices = await prisma.invoice.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      clientId,
      status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
      ...(currency ? { currency } : {}),
    },
    orderBy: { issueDate: 'asc' },
    select: {
      id: true,
      invoiceNumber: true,
      currency: true,
      issueDate: true,
      dueDate: true,
      status: true,
      grandTotal: true,
      amountPaid: true,
      creditedTotal: true,
    },
  });

  return invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    currency: inv.currency,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    status: inv.status,
    balance: outstandingBalance({
      grandTotal: inv.grandTotal.toString(),
      amountPaid: inv.amountPaid.toString(),
      creditedTotal: inv.creditedTotal.toString(),
      currency: inv.currency,
    }),
  }));
}

/** Accounts-receivable ageing buckets, grouped by currency. */
export interface AgingBucket {
  label: string;
  /** Inclusive lower bound of days overdue. */
  minDays: number;
  /** Exclusive upper bound, or null for the open-ended final bucket. */
  maxDays: number | null;
  amountsByCurrency: Record<string, string>;
  count: number;
}

export async function getReceivablesAging(
  ctx: AuthContext,
  asOf: Date = new Date(),
): Promise<AgingBucket[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
    },
    select: {
      currency: true,
      dueDate: true,
      grandTotal: true,
      amountPaid: true,
      creditedTotal: true,
    },
  });

  const buckets: AgingBucket[] = [
    {
      label: 'Not yet due',
      minDays: Number.NEGATIVE_INFINITY,
      maxDays: 1,
      amountsByCurrency: {},
      count: 0,
    },
    { label: '1–30 days', minDays: 1, maxDays: 31, amountsByCurrency: {}, count: 0 },
    { label: '31–60 days', minDays: 31, maxDays: 61, amountsByCurrency: {}, count: 0 },
    { label: '61–90 days', minDays: 61, maxDays: 91, amountsByCurrency: {}, count: 0 },
    { label: '90+ days', minDays: 91, maxDays: null, amountsByCurrency: {}, count: 0 },
  ];

  const today = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());

  for (const invoice of invoices) {
    const balance = outstandingBalance({
      grandTotal: invoice.grandTotal.toString(),
      amountPaid: invoice.amountPaid.toString(),
      creditedTotal: invoice.creditedTotal.toString(),
      currency: invoice.currency,
    });
    if (dec(balance).lessThanOrEqualTo(0)) continue;

    const due = Date.UTC(
      invoice.dueDate.getUTCFullYear(),
      invoice.dueDate.getUTCMonth(),
      invoice.dueDate.getUTCDate(),
    );
    const daysPastDue = Math.floor((today - due) / 86_400_000);

    const bucket = buckets.find(
      (b) => daysPastDue >= b.minDays && (b.maxDays === null || daysPastDue < b.maxDays),
    );
    if (!bucket) continue;

    bucket.count += 1;
    const current = bucket.amountsByCurrency[invoice.currency] ?? '0';
    bucket.amountsByCurrency[invoice.currency] = roundMoney(
      sum([current, balance]),
      invoice.currency,
    ).toString();
  }

  return buckets;
}
