'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Receipt } from 'lucide-react';
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
import { Field, Input, Label } from '@/components/ui/field';
import { Switch } from '@/components/ui/misc';
import { Callout } from '@/components/ui/empty-state';
import { recordSubscriptionCharge } from './actions';
import { formatDate } from '@/lib/dates';

/**
 * Record that a forecast charge actually happened.
 *
 * Creates a real expense and, by default, rolls the schedule forward one
 * period. The forecast itself is never retroactively treated as spend.
 */
export function RecordChargeButton({
  subscriptionId,
  defaultAmount,
  currency,
  nextChargeAt,
  cadenceDescription,
}: {
  subscriptionId: string;
  defaultAmount: string;
  currency: string;
  nextChargeAt: string;
  cadenceDescription: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Receipt /> Record charge
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <RecordChargeBody
            key={open ? 'open' : 'closed'}
            subscriptionId={subscriptionId}
            defaultAmount={defaultAmount}
            currency={currency}
            nextChargeAt={nextChargeAt}
            cadenceDescription={cadenceDescription}
            onClose={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function RecordChargeBody({
  subscriptionId,
  defaultAmount,
  currency,
  nextChargeAt,
  cadenceDescription,
  onClose,
}: {
  subscriptionId: string;
  defaultAmount: string;
  currency: string;
  nextChargeAt: string;
  cadenceDescription: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = React.useState(defaultAmount);
  const [paidAt, setPaidAt] = React.useState(nextChargeAt);
  const [reference, setReference] = React.useState('');
  const [advance, setAdvance] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const valid = /^\d+(\.\d{1,4})?$/.test(amount) && Number(amount) > 0;

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      const result = await recordSubscriptionCharge({
        subscriptionId,
        amount,
        paidAt,
        reference: reference || null,
        advanceSchedule: advance,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success('Charge recorded as an expense', {
        description: advance
          ? `Next charge moved to ${formatDate(result.data.nextChargeAt)}.`
          : 'The schedule was left unchanged.',
      });
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Record a charge</DialogTitle>
        <DialogDescription>
          Logs a real payment that has already left the account, and moves the forecast forward.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4">
        {error ? <Callout tone="danger">{error}</Callout> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Amount charged (${currency})`} required htmlFor="charge-amount">
            <Input
              id="charge-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-right tabular"
              autoFocus
            />
          </Field>
          <Field label="Date paid" required htmlFor="charge-date">
            <Input
              id="charge-date"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Reference" htmlFor="charge-reference" hint="Statement line, receipt number…">
          <Input
            id="charge-reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>

        <label className="flex items-center justify-between gap-4 rounded-lg border border-line px-3.5 py-2.5">
          <span>
            <Label>Advance the schedule</Label>
            <span className="mt-0.5 block text-xs text-ink-subtle">
              Moves the next charge date forward by one {cadenceDescription.toLowerCase()} period.
            </span>
          </span>
          <Switch checked={advance} onCheckedChange={setAdvance} aria-label="Advance the schedule" />
        </label>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} loading={busy} disabled={!valid}>
          Record charge
        </Button>
      </DialogFooter>
    </>
  );
}
