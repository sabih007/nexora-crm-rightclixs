import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState, Callout, EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/shared/status-badge';
import { CurrencyAmount } from '@/components/shared/currency-amount';
import { ActivityTimeline } from '@/components/shared/activity-timeline';
import { InvoiceActionsBar } from '@/features/invoices/invoice-actions-bar';
import { InvoicePaymentPanel } from '@/features/invoices/invoice-payment-panel';
import {
  getInvoiceActivity,
  getInvoiceDetail,
  listOpenInvoicesForClient,
} from '@/features/invoices/queries';
import { daysOverdue } from '@/features/invoices/calculations';
import { formatDate, formatDateTime } from '@/lib/dates';
import { formatNumber } from '@/lib/money';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAuthPage();
  const invoice = await getInvoiceDetail(ctx, id);
  return { title: invoice?.invoiceNumber ?? 'Invoice' };
}

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requireAuthPage();

  if (!roleHasPermission(ctx.role, 'invoice:read')) {
    return (
      <>
        <PageHeader title="Invoice" />
        <NoAccessState what="invoices" />
      </>
    );
  }

  const invoice = await getInvoiceDetail(ctx, id);
  if (!invoice) notFound();

  const [activity, openInvoices] = await Promise.all([
    getInvoiceActivity(ctx, id),
    can(ctx, 'payment:create')
      ? listOpenInvoicesForClient(ctx, invoice.clientId, invoice.currency)
      : Promise.resolve([]),
  ]);

  const address = (invoice.clientSnapshotJson as { address?: Record<string, string> } | null)
    ?.address ??
    (invoice.client.addressJson as Record<string, string> | null) ??
    {};
  const addressLines = [
    address.line1,
    address.line2,
    [address.city, address.state].filter(Boolean).join(', '),
    [address.postalCode, address.country].filter(Boolean).join(' '),
  ].filter((line): line is string => Boolean(line && line.trim()));

  const overdueDays =
    invoice.status === 'OVERDUE' ? daysOverdue(invoice.dueDate) : 0;

  const payments = invoice.allocations.map((a) => ({
    allocationId: a.id,
    allocatedAmount: a.allocatedAmount.toString(),
    ...a.payment,
  }));

  return (
    <>
      <PageHeader
        title={<span className="font-mono">{invoice.invoiceNumber}</span>}
        breadcrumbs={[
          { label: 'Nexora OS', href: '/dashboard' },
          { label: 'Invoices', href: '/invoices' },
          { label: invoice.invoiceNumber },
        ]}
        badge={
          <>
            <StatusBadge kind="invoice" value={invoice.status} />
            <Badge tone="outline">{invoice.currency}</Badge>
            {invoice.issuedAt ? null : <Badge tone="warning">Not issued</Badge>}
          </>
        }
        actions={
          <InvoiceActionsBar
            invoiceId={invoice.id}
            invoiceNumber={invoice.invoiceNumber}
            status={invoice.status}
            clientEmail={invoice.client.email}
            hasPdf={Boolean(invoice.pdfFileId)}
            permissions={{
              update: can(ctx, 'invoice:update'),
              issue: can(ctx, 'invoice:issue'),
              send: can(ctx, 'invoice:send'),
              void: can(ctx, 'invoice:void'),
              delete: can(ctx, 'invoice:delete'),
              downloadPdf: can(ctx, 'invoice:download_pdf'),
              recordPayment: can(ctx, 'payment:create'),
            }}
          />
        }
      />

      {invoice.status === 'VOID' ? (
        <Callout tone="danger" title="This invoice is void" className="mb-4">
          Voided {formatDate(invoice.voidedAt)}
          {invoice.voidReason ? ` — ${invoice.voidReason}` : ''}. It remains on record so the
          numbering stays auditable.
        </Callout>
      ) : null}

      {overdueDays > 0 ? (
        <Callout tone="danger" className="mb-4">
          Overdue by {overdueDays} {overdueDays === 1 ? 'day' : 'days'}. Due{' '}
          {formatDate(invoice.dueDate)}.
        </Callout>
      ) : null}

      {invoice.status === 'DRAFT' ? (
        <Callout tone="info" className="mb-4">
          This is a draft. Amounts can still be changed, no number has been finalised with the
          client, and nothing has been sent.
        </Callout>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-5">
          {/* Document */}
          <Card>
            <CardContent className="pt-5">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                    Bill to
                  </p>
                  <Link
                    href={`/clients/${invoice.client.id}`}
                    className="mt-1 block text-base font-semibold text-ink hover:text-brand-500 hover:underline"
                  >
                    {invoice.client.name}
                  </Link>
                  <div className="mt-1 space-y-0.5 text-sm text-ink-muted">
                    {addressLines.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                    {invoice.client.email ? <p>{invoice.client.email}</p> : null}
                    {invoice.client.taxId ? (
                      <p className="font-mono text-xs">Tax ID: {invoice.client.taxId}</p>
                    ) : null}
                  </div>
                </div>

                <dl className="space-y-1 text-sm">
                  <div className="flex gap-6">
                    <dt className="text-ink-subtle">Issue date</dt>
                    <dd className="ml-auto text-ink">{formatDate(invoice.issueDate)}</dd>
                  </div>
                  <div className="flex gap-6">
                    <dt className="text-ink-subtle">Due date</dt>
                    <dd className="ml-auto text-ink">{formatDate(invoice.dueDate)}</dd>
                  </div>
                  {invoice.project ? (
                    <div className="flex gap-6">
                      <dt className="text-ink-subtle">Project</dt>
                      <dd className="ml-auto">
                        <Link
                          href={`/projects/${invoice.project.id}`}
                          className="text-brand-500 hover:underline"
                        >
                          {invoice.project.name}
                        </Link>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              {/* Line items */}
              <div className="mt-6 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Invoice line items</caption>
                  <thead>
                    <tr className="border-b border-line">
                      <th
                        scope="col"
                        className="pb-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-subtle"
                      >
                        Description
                      </th>
                      <th
                        scope="col"
                        className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-subtle"
                      >
                        Qty
                      </th>
                      <th
                        scope="col"
                        className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-subtle"
                      >
                        Unit price
                      </th>
                      <th
                        scope="col"
                        className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-subtle"
                      >
                        Tax
                      </th>
                      <th
                        scope="col"
                        className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-subtle"
                      >
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.lines.map((line) => (
                      <tr key={line.id} className="border-b border-line last:border-0">
                        <td className="py-2.5 pr-4 text-ink">
                          {line.description}
                          {Number(line.discountAmount) > 0 ? (
                            <span className="block text-xs text-ink-subtle">
                              Discount{' '}
                              <CurrencyAmount
                                amount={line.discountAmount.toString()}
                                currency={invoice.currency}
                                size="sm"
                              />
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2.5 text-right tabular text-ink-muted">
                          {formatNumber(line.quantity.toString(), 4)}
                        </td>
                        <td className="py-2.5 text-right">
                          <CurrencyAmount
                            amount={line.unitPrice.toString()}
                            currency={invoice.currency}
                            muted
                          />
                        </td>
                        <td className="py-2.5 text-right tabular text-ink-muted">
                          {formatNumber(line.taxRate.toString(), 2)}%
                        </td>
                        <td className="py-2.5 text-right">
                          <CurrencyAmount
                            amount={line.lineTotal.toString()}
                            currency={invoice.currency}
                            className="font-medium"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="mt-4 flex justify-end">
                <dl className="w-full max-w-xs space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Subtotal</dt>
                    <dd>
                      <CurrencyAmount
                        amount={invoice.subtotal.toString()}
                        currency={invoice.currency}
                      />
                    </dd>
                  </div>
                  {Number(invoice.discountTotal) > 0 ? (
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Discount</dt>
                      <dd className="text-success">
                        −
                        <CurrencyAmount
                          amount={invoice.discountTotal.toString()}
                          currency={invoice.currency}
                        />
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">
                      Tax
                      {invoice.taxMode === 'INVOICE_LEVEL'
                        ? ` (${formatNumber(invoice.invoiceTaxRate.toString(), 2)}% on subtotal)`
                        : ''}
                    </dt>
                    <dd>
                      <CurrencyAmount
                        amount={invoice.taxTotal.toString()}
                        currency={invoice.currency}
                      />
                    </dd>
                  </div>
                  <div className="flex justify-between border-t border-line pt-1.5 font-semibold">
                    <dt>Total</dt>
                    <dd>
                      <CurrencyAmount
                        amount={invoice.grandTotal.toString()}
                        currency={invoice.currency}
                        size="lg"
                      />
                    </dd>
                  </div>
                  {Number(invoice.amountPaid) > 0 ? (
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Paid</dt>
                      <dd className="text-success">
                        −
                        <CurrencyAmount
                          amount={invoice.amountPaid.toString()}
                          currency={invoice.currency}
                        />
                      </dd>
                    </div>
                  ) : null}
                  {Number(invoice.creditedTotal) > 0 ? (
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Credited</dt>
                      <dd className="text-success">
                        −
                        <CurrencyAmount
                          amount={invoice.creditedTotal.toString()}
                          currency={invoice.currency}
                        />
                      </dd>
                    </div>
                  ) : null}
                  {Number(invoice.amountPaid) > 0 || Number(invoice.creditedTotal) > 0 ? (
                    <div className="flex justify-between border-t border-line pt-1.5 font-semibold">
                      <dt>Balance due</dt>
                      <dd>
                        <CurrencyAmount
                          amount={invoice.balance}
                          currency={invoice.currency}
                          size="lg"
                          tone={Number(invoice.balance) > 0 ? 'negative' : 'positive'}
                        />
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              {invoice.terms || invoice.notes ? (
                <div className="mt-6 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
                  {invoice.terms ? (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                        Terms
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">
                        {invoice.terms}
                      </p>
                    </div>
                  ) : null}
                  {invoice.notes ? (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                        Notes
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">
                        {invoice.notes}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Payments */}
          {can(ctx, 'payment:read') ? (
            <InvoicePaymentPanel
              invoiceId={invoice.id}
              clientId={invoice.clientId}
              clientName={invoice.client.name}
              currency={invoice.currency}
              status={invoice.status}
              balance={invoice.balance}
              payments={payments.map((p) => ({
                id: p.id,
                allocationId: p.allocationId,
                allocatedAmount: p.allocatedAmount,
                amount: p.amount.toString(),
                currency: p.currency,
                paymentDate: p.paymentDate,
                method: p.method,
                reference: p.reference,
                notes: p.notes,
                createdBy: p.createdBy.name,
              }))}
              creditNotes={invoice.creditNotes.map((cn) => ({
                id: cn.id,
                number: cn.number,
                amount: cn.amount.toString(),
                currency: cn.currency,
                reason: cn.reason,
                issuedAt: cn.issuedAt,
              }))}
              openInvoices={openInvoices}
              autoOpenPayment={query.payment === '1'}
              canRecordPayment={can(ctx, 'payment:create')}
              canDeletePayment={can(ctx, 'payment:delete')}
              canCreateCreditNote={can(ctx, 'creditnote:create')}
            />
          ) : null}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <TimelineRow label="Created" value={formatDateTime(invoice.createdAt)} />
              <TimelineRow
                label="Issued"
                value={invoice.issuedAt ? formatDateTime(invoice.issuedAt) : 'Not issued'}
              />
              <TimelineRow
                label="Sent"
                value={invoice.sentAt ? formatDateTime(invoice.sentAt) : 'Not sent'}
              />
              <TimelineRow
                label="Paid"
                value={invoice.paidAt ? formatDateTime(invoice.paidAt) : 'Outstanding'}
              />
              {invoice.voidedAt ? (
                <TimelineRow label="Voided" value={formatDateTime(invoice.voidedAt)} />
              ) : null}
            </CardContent>
          </Card>

          {invoice.issuedSnapshotJson ? (
            <Card>
              <CardHeader>
                <CardTitle>Issued snapshot</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs leading-relaxed text-ink-subtle">
                  A frozen copy of the amounts and the client&rsquo;s billing details was captured
                  when this invoice was issued. The PDF is rendered from that snapshot, so what the
                  client received can always be reproduced exactly.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <EmptyState title="No activity" compact />
              ) : (
                <ActivityTimeline entries={activity} />
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}

function TimelineRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-subtle">{label}</span>
      <span className="text-right text-ink">{value}</span>
    </div>
  );
}
