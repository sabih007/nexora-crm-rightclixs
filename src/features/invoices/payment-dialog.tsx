'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input, Label, Select, Textarea } from '@/components/ui/field';
import { Callout } from '@/components/ui/empty-state';
import { CurrencyAmount } from '@/components/shared/currency-amount';
import { StatusBadge } from '@/components/shared/status-badge';
import { allocatePayment } from './calculations';
import { PAYMENT_METHODS } from './schemas';
import { recordPayment } from './actions';
import { formatDate } from '@/lib/dates';
import { dec } from '@/lib/money';

export interface OpenInvoiceOption {
  id: string;
  invoiceNumber: string;
  currency: string;
  issueDate: Date | string;
  dueDate: Date | string;
  status: string;
  balance: string;
}

const METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: 'Bank transfer',
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  CARD: 'Card',
  ONLINE: 'Online',
  OTHER: 'Other',
};

/**
 * Record a manual payment.
 *
 * Carries a client-generated idempotency key so a double-click or a retried
 * request cannot create two payments. The allocation preview shown here uses
 * the same `allocatePayment` the server runs.
 */
export function PaymentDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  currency,
  openInvoices,
  preselectedInvoiceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  currency: string;
  openInvoices: OpenInvoiceOption[];
  preselectedInvoiceId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {/* Keyed so a cancelled entry never leaks into the next one, and a new
            idempotency key is minted per attempt. */}
        <PaymentDialogBody
          key={open ? 'open' : 'closed'}
          clientId={clientId}
          clientName={clientName}
          currency={currency}
          openInvoices={openInvoices}
          preselectedInvoiceId={preselectedInvoiceId}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialogBody({
  clientId,
  clientName,
  currency,
  openInvoices,
  preselectedInvoiceId,
  onClose,
}: {
  clientId: string;
  clientName: string;
  currency: string;
  openInvoices: OpenInvoiceOption[];
  preselectedInvoiceId?: string;
  onClose: () => void;
}) {
  const router = useRouter();

  const relevant = React.useMemo(
    () => openInvoices.filter((inv) => inv.currency === currency),
    [openInvoices, currency],
  );

  const [amount, setAmount] = React.useState(
    preselectedInvoiceId
      ? (relevant.find((i) => i.id === preselectedInvoiceId)?.balance ?? '')
      : '',
  );
  const [paymentDate, setPaymentDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = React.useState<(typeof PAYMENT_METHODS)[number]>('BANK_TRANSFER');
  const [reference, setReference] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * Idempotency key for this attempt.
   *
   * Minted inside the submit handler rather than during render (generating
   * randomness while rendering is impure) and held in a ref, so a double
   * click or a retry after a network blip reuses the same key and the server
   * treats the second request as a no-op instead of a second payment.
   */
  const idempotencyKeyRef = React.useRef<string | null>(null);

  function currentIdempotencyKey(): string {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = `pay_${crypto.randomUUID()}`;
    }
    return idempotencyKeyRef.current;
  }

  const validAmount = /^\d+(\.\d{1,4})?$/.test(amount) && Number(amount) > 0;

  // Preview the allocation, preferring the invoice the user came from.
  const preview = React.useMemo(() => {
    if (!validAmount) return null;
    const ordered = preselectedInvoiceId
      ? [
          ...relevant.filter((i) => i.id === preselectedInvoiceId),
          ...relevant.filter((i) => i.id !== preselectedInvoiceId),
        ]
      : relevant;
    return allocatePayment(
      amount,
      ordered.map((i) => ({ invoiceId: i.id, balance: i.balance })),
      currency,
    );
  }, [amount, validAmount, relevant, preselectedInvoiceId, currency]);

  const invoiceById = React.useMemo(
    () => Object.fromEntries(relevant.map((i) => [i.id, i])),
    [relevant],
  );

  async function handleSubmit() {
    setError(null);
    if (!validAmount) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setBusy(true);
    try {
      const result = await recordPayment({
        clientId,
        invoiceId: preselectedInvoiceId ?? null,
        amount,
        currency,
        paymentDate,
        method,
        reference: reference || null,
        notes: notes || null,
        allocations: [],
        idempotencyKey: currentIdempotencyKey(),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.data.duplicate) {
        toast.info('This payment was already recorded.');
      } else {
        const unallocated = result.data.unallocated;
        toast.success('Payment recorded', {
          description:
            unallocated && dec(unallocated).greaterThan(0)
              ? `${currency} ${unallocated} could not be allocated and is held as a client credit.`
              : undefined,
        });
      }
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Record a payment</DialogTitle>
        <DialogDescription>
          Logs money received from {clientName}. Nothing is charged — this records a payment that
          already happened.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4">
        {error ? <Callout tone="danger">{error}</Callout> : null}

        {relevant.length === 0 ? (
          <Callout tone="warning">
            {clientName} has no open invoices in {currency}. The payment will be recorded and held
            as an unallocated credit.
          </Callout>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Amount (${currency})`} required htmlFor="payment-amount">
            <Input
              id="payment-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="text-right tabular"
              autoFocus
            />
          </Field>

          <Field label="Payment date" required htmlFor="payment-date">
            <Input
              id="payment-date"
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </Field>

          <Field label="Method" htmlFor="payment-method">
            <Select
              id="payment-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as (typeof PAYMENT_METHODS)[number])}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Reference" htmlFor="payment-reference" hint="Transaction ID, cheque number…">
            <Input
              id="payment-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Notes" htmlFor="payment-notes">
          <Textarea
            id="payment-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        {preview && preview.allocations.length > 0 ? (
          <div>
            <Label>Allocation</Label>
            <p className="mt-0.5 text-xs text-ink-subtle">
              Applied oldest first, never exceeding each invoice&rsquo;s outstanding balance.
            </p>
            <ul className="mt-2 divide-y divide-[var(--line)] overflow-hidden rounded-lg border border-line">
              {preview.allocations.map((allocation) => {
                const invoice = invoiceById[allocation.invoiceId];
                if (!invoice) return null;
                return (
                  <li
                    key={allocation.invoiceId}
                    className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-[13px] text-ink">{invoice.invoiceNumber}</span>
                    <StatusBadge kind="invoice" value={invoice.status} size="sm" />
                    <span className="text-xs text-ink-subtle">
                      due {formatDate(invoice.dueDate)} · balance{' '}
                      <CurrencyAmount amount={invoice.balance} currency={currency} size="sm" />
                    </span>
                    <CurrencyAmount
                      amount={allocation.allocatedAmount}
                      currency={currency}
                      className="ml-auto font-medium"
                      tone="positive"
                    />
                  </li>
                );
              })}
            </ul>

            {dec(preview.unallocated).greaterThan(0) ? (
              <Callout tone="warning" className="mt-2">
                <CurrencyAmount amount={preview.unallocated} currency={currency} /> exceeds the
                total outstanding and will be held as an unallocated client credit rather than
                overpaying an invoice.
              </Callout>
            ) : null}
          </div>
        ) : null}
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} loading={busy} disabled={!validAmount}>
          Record payment
        </Button>
      </DialogFooter>
    </>
  );
}
