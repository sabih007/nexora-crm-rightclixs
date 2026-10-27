'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { GripVertical, Info, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Label, Select, Textarea } from '@/components/ui/field';
import { Callout } from '@/components/ui/empty-state';
import { Tooltip } from '@/components/ui/misc';
import { CurrencyAmount } from '@/components/shared/currency-amount';
import { CURRENCIES, PRIORITY_CURRENCIES } from '@/lib/money';
import { computeInvoiceTotals } from './calculations';
import { invoiceInputSchema, type InvoiceFormValues, type InvoiceInput } from './schemas';
import { createInvoice, updateInvoice } from './actions';

/**
 * Invoice builder.
 *
 * Totals shown here are computed with the very same `computeInvoiceTotals`
 * the server uses, so the preview and the saved record cannot disagree — and
 * the server still recomputes on submit rather than trusting these numbers.
 */
export function InvoiceForm({
  defaults,
  invoiceId,
  clients,
  projects,
  defaultTerms,
  defaultPaymentTermDays,
}: {
  defaults?: Partial<InvoiceFormValues>;
  invoiceId?: string;
  clients: { id: string; name: string; billingCurrency: string }[];
  projects: { id: string; name: string; clientId: string | null }[];
  defaultTerms: string;
  defaultPaymentTermDays: number;
}) {
  const router = useRouter();
  const isEdit = Boolean(invoiceId);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const defaultDue = new Date(Date.now() + defaultPaymentTermDays * 864e5)
    .toISOString()
    .slice(0, 10);

  const form = useForm<InvoiceFormValues, unknown, InvoiceInput>({
    resolver: zodResolver(invoiceInputSchema),
    defaultValues: {
      clientId: defaults?.clientId ?? '',
      projectId: defaults?.projectId ?? null,
      currency: defaults?.currency ?? 'PKR',
      issueDate: defaults?.issueDate ?? today,
      dueDate: defaults?.dueDate ?? defaultDue,
      taxMode: defaults?.taxMode ?? 'PER_LINE',
      invoiceTaxRate: defaults?.invoiceTaxRate ?? '0',
      terms: defaults?.terms ?? defaultTerms,
      notes: defaults?.notes ?? null,
      lines: defaults?.lines ?? [
        { description: '', quantity: '1', unitPrice: '0', discountAmount: '0', taxRate: '0' },
      ],
    },
  });

  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  const lines = useFieldArray({ control, name: 'lines' });

  /**
   * `useWatch` rather than `watch` for the line array.
   *
   * `watch('lines')` hands back a reference into React Hook Form's internal
   * values object, and editing a nested field mutates it in place. Memoising
   * on that reference therefore never invalidates, and the preview silently
   * stays at zero while the user types. `useWatch` returns a fresh value on
   * each change, and the totals are cheap enough to compute every render.
   */
  const watchedLines = useWatch({ control, name: 'lines' });
  const currency = watch('currency') || 'PKR';
  const taxMode = watch('taxMode') ?? 'PER_LINE';
  const invoiceTaxRate = watch('invoiceTaxRate') ?? '0';
  const selectedClientId = watch('clientId');

  // Wrapped because a half-typed value ("1.") is not yet a valid decimal;
  // the form shows zeros until it parses.
  let totals: ReturnType<typeof computeInvoiceTotals> | null = null;
  try {
    totals = computeInvoiceTotals({
      lines: (watchedLines ?? []).map((l) => ({
        quantity: l?.quantity || '0',
        unitPrice: l?.unitPrice || '0',
        discountAmount: l?.discountAmount || '0',
        taxRate: l?.taxRate || '0',
      })),
      currency,
      taxMode,
      invoiceTaxRate: invoiceTaxRate || '0',
    });
  } catch {
    totals = null;
  }

  const availableProjects = projects.filter(
    (p) => !selectedClientId || p.clientId === selectedClientId || p.clientId === null,
  );

  function onClientChange(clientId: string) {
    setValue('clientId', clientId, { shouldDirty: true, shouldValidate: true });
    const client = clients.find((c) => c.id === clientId);
    if (client) setValue('currency', client.billingCurrency, { shouldDirty: true });
    // Clear a project that no longer belongs to the chosen client.
    const projectId = form.getValues('projectId');
    if (projectId) {
      const project = projects.find((p) => p.id === projectId);
      if (project && project.clientId && project.clientId !== clientId) {
        setValue('projectId', null, { shouldDirty: true });
      }
    }
  }

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const result = isEdit
      ? await updateInvoice({ id: invoiceId!, data: values })
      : await createInvoice(values);

    if (!result.ok) {
      setServerError(result.error);
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          form.setError(field as keyof InvoiceFormValues, { message: messages[0] });
        }
      }
      return;
    }

    toast.success(isEdit ? 'Invoice saved' : 'Draft invoice created');
    router.push(`/invoices/${result.data.id}`);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {serverError ? <Callout tone="danger">{serverError}</Callout> : null}

      <Callout tone="info">
        The invoice is saved as a <strong>draft</strong>. Nothing is issued, numbered as final, or
        sent until you explicitly issue it.
      </Callout>

      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Client" required error={errors.clientId?.message} htmlFor="clientId">
            <Select
              id="clientId"
              value={selectedClientId ?? ''}
              onChange={(e) => onClientChange(e.target.value)}
            >
              <option value="">Select a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.billingCurrency})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Project" error={errors.projectId?.message} htmlFor="projectId">
            <Select id="projectId" {...register('projectId')}>
              <option value="">No project</option>
              {availableProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Currency" required error={errors.currency?.message} htmlFor="currency">
            <Select id="currency" {...register('currency')}>
              <optgroup label="Common">
                {PRIORITY_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </optgroup>
              <optgroup label="All currencies">
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>

          <Field
            label="Tax handling"
            htmlFor="taxMode"
            hint={
              taxMode === 'PER_LINE'
                ? 'Each line carries its own rate.'
                : 'One rate applies to the whole net subtotal.'
            }
          >
            <Select id="taxMode" {...register('taxMode')}>
              <option value="PER_LINE">Per line item</option>
              <option value="INVOICE_LEVEL">Single invoice-level rate</option>
            </Select>
          </Field>

          {taxMode === 'INVOICE_LEVEL' ? (
            <Field
              label="Invoice tax rate (%)"
              error={errors.invoiceTaxRate?.message}
              htmlFor="invoiceTaxRate"
            >
              <Input id="invoiceTaxRate" inputMode="decimal" {...register('invoiceTaxRate')} />
            </Field>
          ) : null}

          <Field label="Issue date" required error={errors.issueDate?.message} htmlFor="issueDate">
            <Input id="issueDate" type="date" {...register('issueDate')} />
          </Field>

          <Field label="Due date" required error={errors.dueDate?.message} htmlFor="dueDate">
            <Input id="dueDate" type="date" {...register('dueDate')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Line items</CardTitle>
            <p className="mt-0.5 text-xs text-ink-subtle">
              Discounts are absolute amounts and are applied before tax.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              lines.append({
                description: '',
                quantity: '1',
                unitPrice: '0',
                discountAmount: '0',
                taxRate: '0',
              })
            }
          >
            <Plus /> Add line
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {errors.lines?.message ? (
            <p role="alert" className="text-xs text-danger">
              {errors.lines.message}
            </p>
          ) : null}

          {/* Column headings, desktop only. */}
          <div className="hidden gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle lg:grid lg:grid-cols-[1.5rem_1fr_5rem_7rem_7rem_5rem_7rem_2rem]">
            <span />
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit price</span>
            <span className="text-right">Discount</span>
            <span className="text-right">Tax %</span>
            <span className="text-right">Amount</span>
            <span />
          </div>

          {lines.fields.map((field, index) => {
            const computed = totals?.lines[index];
            return (
              <div
                key={field.id}
                className="grid gap-2 rounded-lg border border-line bg-surface-sunken/40 p-2.5 lg:grid-cols-[1.5rem_1fr_5rem_7rem_7rem_5rem_7rem_2rem] lg:items-center lg:border-transparent lg:bg-transparent lg:p-1"
              >
                <span
                  className="hidden items-center justify-center text-ink-subtle lg:flex"
                  aria-hidden
                >
                  <GripVertical className="size-3.5" />
                </span>

                <div>
                  <Label className="lg:sr-only">Description</Label>
                  <Input
                    {...register(`lines.${index}.description`)}
                    placeholder="What is being billed"
                    aria-label={`Line ${index + 1} description`}
                    aria-invalid={errors.lines?.[index]?.description ? true : undefined}
                  />
                  {errors.lines?.[index]?.description ? (
                    <p className="mt-1 text-xs text-danger">
                      {errors.lines[index]?.description?.message}
                    </p>
                  ) : null}
                </div>

                <div>
                  <Label className="lg:sr-only">Qty</Label>
                  <Input
                    inputMode="decimal"
                    className="text-right tabular"
                    {...register(`lines.${index}.quantity`)}
                    aria-label={`Line ${index + 1} quantity`}
                  />
                </div>

                <div>
                  <Label className="lg:sr-only">Unit price</Label>
                  <Input
                    inputMode="decimal"
                    className="text-right tabular"
                    {...register(`lines.${index}.unitPrice`)}
                    aria-label={`Line ${index + 1} unit price`}
                  />
                </div>

                <div>
                  <Label className="lg:sr-only">Discount</Label>
                  <Input
                    inputMode="decimal"
                    className="text-right tabular"
                    {...register(`lines.${index}.discountAmount`)}
                    aria-label={`Line ${index + 1} discount`}
                  />
                </div>

                <div>
                  <Label className="lg:sr-only">Tax %</Label>
                  <Input
                    inputMode="decimal"
                    className="text-right tabular"
                    disabled={taxMode === 'INVOICE_LEVEL'}
                    {...register(`lines.${index}.taxRate`)}
                    aria-label={`Line ${index + 1} tax rate`}
                  />
                </div>

                <div className="flex items-center justify-between lg:justify-end">
                  <span className="text-xs text-ink-subtle lg:hidden">Amount</span>
                  <CurrencyAmount
                    amount={computed?.lineTotal ?? '0'}
                    currency={currency}
                    className="font-medium"
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove line ${index + 1}`}
                    disabled={lines.fields.length === 1}
                    onClick={() => lines.remove(index)}
                  >
                    <Trash2 className="text-danger" />
                  </Button>
                </div>
              </div>
            );
          })}

          {/* Totals */}
          <div className="mt-3 flex justify-end border-t border-line pt-3">
            <dl className="w-full max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">Subtotal</dt>
                <dd>
                  <CurrencyAmount amount={totals?.subtotal ?? '0'} currency={currency} />
                </dd>
              </div>
              {totals && Number(totals.discountTotal) > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Discount</dt>
                  <dd className="text-success">
                    −<CurrencyAmount amount={totals.discountTotal} currency={currency} />
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="flex items-center gap-1 text-ink-muted">
                  Tax
                  <Tooltip
                    content={
                      taxMode === 'PER_LINE'
                        ? 'Sum of each line’s tax, each rounded to the currency’s minor unit.'
                        : 'The invoice rate applied to the net subtotal, rounded once.'
                    }
                  >
                    <span className="cursor-help text-ink-subtle">
                      <Info className="size-3" aria-hidden />
                    </span>
                  </Tooltip>
                </dt>
                <dd>
                  <CurrencyAmount amount={totals?.taxTotal ?? '0'} currency={currency} />
                </dd>
              </div>
              <div className="flex justify-between border-t border-line pt-1.5 text-base font-semibold">
                <dt>Total</dt>
                <dd>
                  <CurrencyAmount
                    amount={totals?.grandTotal ?? '0'}
                    currency={currency}
                    size="lg"
                  />
                </dd>
              </div>
            </dl>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Terms and notes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment terms" htmlFor="terms">
            <Textarea id="terms" rows={3} {...register('terms')} />
          </Field>
          <Field label="Notes to the client" htmlFor="notes">
            <Textarea id="notes" rows={3} {...register('notes')} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {isEdit ? 'Save draft' : 'Create draft'}
        </Button>
      </div>
    </form>
  );
}
