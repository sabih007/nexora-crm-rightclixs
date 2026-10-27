'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Field, Input, Label, Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/empty-state';
import { Switch } from '@/components/ui/misc';
import type { WorkspaceSettings } from '@/lib/workspace';
import { updateInvoiceDefaults } from './actions';

export function InvoiceDefaultsForm({
  settings,
  canEdit,
}: {
  settings: WorkspaceSettings;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = React.useState(settings);
  const [renewalDraft, setRenewalDraft] = React.useState('');
  const [invoiceDraft, setInvoiceDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function set<K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function addDay(
    key: 'renewalReminderDays' | 'invoiceReminderDays',
    raw: string,
    reset: () => void,
  ) {
    const parsed = Number(raw.trim());
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) {
      reset();
      return;
    }
    if (values[key].includes(parsed)) {
      reset();
      return;
    }
    set(key, [...values[key], parsed].sort((a, b) => b - a));
    reset();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await updateInvoiceDefaults(values);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success('Defaults saved');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const sampleNumber = `${values.invoiceNumberIncludeYear ? 'INV-2026-' : 'INV-'}${'1'.padStart(
    values.invoiceNumberPadding,
    '0',
  )}`;

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardContent className="space-y-5 pt-5">
          {error ? <Callout tone="danger">{error}</Callout> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Payment terms (days)"
              htmlFor="term-days"
              hint="Default gap between issue date and due date."
            >
              <Input
                id="term-days"
                inputMode="numeric"
                value={String(values.defaultPaymentTermDays)}
                onChange={(e) =>
                  set('defaultPaymentTermDays', Number(e.target.value.replace(/\D/g, '') || 0))
                }
                disabled={!canEdit}
              />
            </Field>

            <Field
              label="Default tax rate (%)"
              htmlFor="tax-rate"
              hint="Pre-filled on new invoice lines."
            >
              <Input
                id="tax-rate"
                inputMode="decimal"
                value={values.defaultTaxRate}
                onChange={(e) => set('defaultTaxRate', e.target.value)}
                disabled={!canEdit}
              />
            </Field>

            <Field
              label="Number padding"
              htmlFor="padding"
              hint={`Produces ${sampleNumber}`}
            >
              <Input
                id="padding"
                inputMode="numeric"
                value={String(values.invoiceNumberPadding)}
                onChange={(e) =>
                  set(
                    'invoiceNumberPadding',
                    Math.min(10, Math.max(1, Number(e.target.value.replace(/\D/g, '') || 1))),
                  )
                }
                disabled={!canEdit}
              />
            </Field>

            <label className="flex items-center justify-between gap-4 self-end rounded-lg border border-line px-3.5 py-2.5">
              <span>
                <Label>Include the year</Label>
                <span className="mt-0.5 block text-xs text-ink-subtle">
                  Restarts numbering visually each year.
                </span>
              </span>
              <Switch
                checked={values.invoiceNumberIncludeYear}
                onCheckedChange={(checked) => set('invoiceNumberIncludeYear', checked)}
                disabled={!canEdit}
                aria-label="Include the year in invoice numbers"
              />
            </label>
          </div>

          <Field label="Default payment terms text" htmlFor="terms-text">
            <Textarea
              id="terms-text"
              rows={2}
              value={values.defaultInvoiceTerms}
              onChange={(e) => set('defaultInvoiceTerms', e.target.value)}
              disabled={!canEdit}
            />
          </Field>

          <Field label="Default invoice notes" htmlFor="notes-text">
            <Textarea
              id="notes-text"
              rows={2}
              value={values.defaultInvoiceNotes}
              onChange={(e) => set('defaultInvoiceNotes', e.target.value)}
              disabled={!canEdit}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <DayChips
              label="Renewal reminders"
              hint="Days before a subscription charge to raise a notification."
              days={values.renewalReminderDays}
              draft={renewalDraft}
              onDraftChange={setRenewalDraft}
              onAdd={() => addDay('renewalReminderDays', renewalDraft, () => setRenewalDraft(''))}
              onRemove={(day) =>
                set(
                  'renewalReminderDays',
                  values.renewalReminderDays.filter((d) => d !== day),
                )
              }
              disabled={!canEdit}
            />

            <DayChips
              label="Overdue invoice reminders"
              hint="Days after the due date to raise a notification."
              days={values.invoiceReminderDays}
              draft={invoiceDraft}
              onDraftChange={setInvoiceDraft}
              onAdd={() => addDay('invoiceReminderDays', invoiceDraft, () => setInvoiceDraft(''))}
              onRemove={(day) =>
                set(
                  'invoiceReminderDays',
                  values.invoiceReminderDays.filter((d) => d !== day),
                )
              }
              disabled={!canEdit}
            />
          </div>

          <p className="text-[11px] leading-relaxed text-ink-subtle">
            Reminders are raised by the daily job at{' '}
            <code className="font-mono">/api/cron/reminders</code>. They are deduplicated per
            charge cycle, so running the job more than once a day sends nothing twice.
          </p>
        </CardContent>

        {canEdit ? (
          <CardFooter className="justify-end">
            <Button type="submit" loading={busy}>
              Save defaults
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </form>
  );
}

function DayChips({
  label,
  hint,
  days,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
  disabled,
}: {
  label: string;
  hint: string;
  days: number[];
  draft: string;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (day: number) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="mt-0.5 text-xs text-ink-subtle">{hint}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {days.map((day) => (
          <Badge key={day} tone="brand" className="gap-1 pr-1">
            {day}d
            {!disabled ? (
              <button
                type="button"
                aria-label={`Remove the ${day} day reminder`}
                onClick={() => onRemove(day)}
                className="rounded-full p-0.5 hover:bg-brand-500/20"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </Badge>
        ))}
        {!disabled ? (
          <Input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAdd();
              }
            }}
            onBlur={onAdd}
            placeholder="add"
            aria-label={`Add a day to ${label}`}
            className="h-7 w-16 text-xs"
          />
        ) : null}
        {days.length === 0 ? (
          <span className="text-xs text-ink-subtle">None — no reminders will be sent.</span>
        ) : null}
      </div>
    </div>
  );
}
