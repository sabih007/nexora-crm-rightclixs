'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FileMinus, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/field';
import { CurrencyAmount } from '@/components/shared/currency-amount';
import { PaymentDialog, type OpenInvoiceOption } from './payment-dialog';
import { createCreditNote, deletePayment } from './actions';
import { formatDate } from '@/lib/dates';

const METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: 'Bank transfer',
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  CARD: 'Card',
  ONLINE: 'Online',
  OTHER: 'Other',
};

interface PaymentRow {
  id: string;
  allocationId: string;
  allocatedAmount: string;
  amount: string;
  currency: string;
  paymentDate: Date | string;
  method: string;
  reference: string | null;
  notes: string | null;
  createdBy: string;
}

interface CreditNoteRow {
  id: string;
  number: string;
  amount: string;
  currency: string;
  reason: string;
  issuedAt: Date | string;
}

/** Payments and credit notes recorded against one invoice. */
export function InvoicePaymentPanel({
  invoiceId,
  clientId,
  clientName,
  currency,
  status,
  balance,
  payments,
  creditNotes,
  openInvoices,
  autoOpenPayment,
  canRecordPayment,
  canDeletePayment,
  canCreateCreditNote,
}: {
  invoiceId: string;
  clientId: string;
  clientName: string;
  currency: string;
  status: string;
  balance: string;
  payments: PaymentRow[];
  creditNotes: CreditNoteRow[];
  openInvoices: OpenInvoiceOption[];
  autoOpenPayment: boolean;
  canRecordPayment: boolean;
  canDeletePayment: boolean;
  canCreateCreditNote: boolean;
}) {
  const router = useRouter();
  const [paymentOpen, setPaymentOpen] = React.useState(autoOpenPayment);
  const [creditOpen, setCreditOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<PaymentRow | null>(null);

  const settled = Number(balance) <= 0;
  const canTransact = !['DRAFT', 'VOID', 'CANCELLED'].includes(status);

  async function handleDeletePayment() {
    if (!deleteTarget) return;
    const result = await deletePayment({ id: deleteTarget.id });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Payment removed');
    setDeleteTarget(null);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Payments &amp; credits</CardTitle>
          <p className="mt-0.5 text-xs text-ink-subtle">
            Manually recorded receipts. Nexora OS never charges a card or moves money.
          </p>
        </div>
        <div className="flex gap-2">
          {canCreateCreditNote && canTransact && !settled ? (
            <Button variant="secondary" size="sm" onClick={() => setCreditOpen(true)}>
              <FileMinus /> Credit note
            </Button>
          ) : null}
          {canRecordPayment && canTransact && !settled ? (
            <Button size="sm" onClick={() => setPaymentOpen(true)}>
              <Plus /> Record payment
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent>
        {payments.length === 0 && creditNotes.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description={
              canTransact
                ? 'Record a payment when money arrives, or issue a credit note to reduce the balance.'
                : 'Payments can be recorded once the invoice is issued.'
            }
            compact
          />
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {payments.map((payment) => (
              <li
                key={payment.allocationId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0"
              >
                <span className="text-sm text-ink">{formatDate(payment.paymentDate)}</span>
                <Badge tone="outline">{METHOD_LABELS[payment.method] ?? payment.method}</Badge>
                {payment.reference ? (
                  <span className="truncate text-xs text-ink-subtle">ref {payment.reference}</span>
                ) : null}
                <span className="text-xs text-ink-subtle">by {payment.createdBy}</span>

                <span className="ml-auto flex items-center gap-3">
                  {payment.allocatedAmount !== payment.amount ? (
                    <span className="text-[11px] text-ink-subtle">
                      of{' '}
                      <CurrencyAmount
                        amount={payment.amount}
                        currency={payment.currency}
                        size="sm"
                      />{' '}
                      received
                    </span>
                  ) : null}
                  <CurrencyAmount
                    amount={payment.allocatedAmount}
                    currency={payment.currency}
                    className="font-medium"
                    tone="positive"
                  />
                  {canDeletePayment ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove payment of ${payment.amount}`}
                      onClick={() => setDeleteTarget(payment)}
                    >
                      <Trash2 className="text-danger" />
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}

            {creditNotes.map((note) => (
              <li key={note.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="text-sm text-ink">{formatDate(note.issuedAt)}</span>
                <Badge tone="info">Credit note {note.number}</Badge>
                <span className="truncate text-xs text-ink-subtle">{note.reason}</span>
                <CurrencyAmount
                  amount={note.amount}
                  currency={note.currency}
                  className="ml-auto font-medium"
                  tone="positive"
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        clientId={clientId}
        clientName={clientName}
        currency={currency}
        openInvoices={openInvoices}
        preselectedInvoiceId={invoiceId}
      />

      <CreditNoteDialog
        open={creditOpen}
        onOpenChange={setCreditOpen}
        invoiceId={invoiceId}
        currency={currency}
        maxAmount={balance}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        title="Remove this payment?"
        description="The payment record is deleted and the invoice balance recalculated. The removal is recorded in the audit log."
        confirmLabel="Remove payment"
        onConfirm={handleDeletePayment}
      />
    </Card>
  );
}

function CreditNoteDialog({
  open,
  onOpenChange,
  invoiceId,
  currency,
  maxAmount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  currency: string;
  maxAmount: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = React.useState(maxAmount);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function handleSubmit() {
    setBusy(true);
    try {
      const result = await createCreditNote({ invoiceId, amount, reason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Credit note ${result.data.number} issued`);
      onOpenChange(false);
      setReason('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const valid =
    /^\d+(\.\d{1,4})?$/.test(amount) &&
    Number(amount) > 0 &&
    Number(amount) <= Number(maxAmount) &&
    reason.trim().length >= 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue a credit note</DialogTitle>
          <DialogDescription>
            Reduces the balance without altering the issued invoice. Use this instead of editing an
            invoice the client has already received.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field
            label={`Amount (${currency})`}
            required
            htmlFor="credit-amount"
            hint={`Cannot exceed the ${currency} ${maxAmount} still outstanding.`}
          >
            <Input
              id="credit-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-right tabular"
            />
          </Field>
          <Field label="Reason" required htmlFor="credit-reason">
            <Textarea
              id="credit-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this credit being issued?"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={busy} disabled={!valid}>
            Issue credit note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
