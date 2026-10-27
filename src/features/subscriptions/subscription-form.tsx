'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Callout } from '@/components/ui/empty-state';
import { Switch } from '@/components/ui/misc';
import { Label } from '@/components/ui/field';
import { CurrencyAmount } from '@/components/shared/currency-amount';
import { statusLabel } from '@/components/shared/status-badge';
import { CURRENCIES, PRIORITY_CURRENCIES } from '@/lib/money';
import {
  CADENCES,
  EXPENSE_CATEGORIES,
  SUBSCRIPTION_STATUSES,
  subscriptionInputSchema,
  type SubscriptionFormValues,
  type SubscriptionInput,
} from './schemas';
import {
  annualizedCost,
  cadenceLabel,
  CADENCE_LABELS,
  cancellationDeadline,
  monthlyEquivalent,
  type Cadence,
} from './forecast';
import { createSubscription, updateSubscription } from './actions';
import { formatDate, fromDateInput } from '@/lib/dates';

export function SubscriptionForm({
  defaults,
  subscriptionId,
  platforms,
  cards,
  clients,
  projects,
  workspaceCurrency,
}: {
  defaults?: Partial<SubscriptionFormValues>;
  subscriptionId?: string;
  platforms: { id: string; name: string; category: string }[];
  cards: { id: string; nickname: string; last4: string }[];
  clients: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  workspaceCurrency: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(subscriptionId);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const form = useForm<SubscriptionFormValues, unknown, SubscriptionInput>({
    resolver: zodResolver(subscriptionInputSchema),
    defaultValues: {
      platformId: defaults?.platformId ?? '',
      cardId: defaults?.cardId ?? null,
      projectId: defaults?.projectId ?? null,
      clientId: defaults?.clientId ?? null,
      planName: defaults?.planName ?? '',
      amount: defaults?.amount ?? '',
      currency: defaults?.currency ?? workspaceCurrency,
      cadence: defaults?.cadence ?? 'MONTHLY',
      intervalDays: defaults?.intervalDays ?? '',
      nextChargeAt: defaults?.nextChargeAt ?? today,
      startedAt: defaults?.startedAt ?? today,
      endsAt: defaults?.endsAt ?? null,
      trialEndsAt: defaults?.trialEndsAt ?? null,
      autoRenew: defaults?.autoRenew ?? true,
      status: defaults?.status ?? 'ACTIVE',
      category: defaults?.category ?? 'Software',
      costCenter: defaults?.costCenter ?? null,
      noticeDays: defaults?.noticeDays ?? '',
      taxInclusive: defaults?.taxInclusive ?? true,
      notes: defaults?.notes ?? null,
    },
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  const amount = watch('amount');
  const currency = watch('currency') || workspaceCurrency;
  const cadence = (watch('cadence') ?? 'MONTHLY') as Cadence;
  const intervalDaysRaw = watch('intervalDays');
  const nextChargeAt = watch('nextChargeAt');
  const noticeDaysRaw = watch('noticeDays');
  const autoRenew = watch('autoRenew') ?? true;
  const taxInclusive = watch('taxInclusive') ?? true;

  const intervalDays =
    intervalDaysRaw === '' || intervalDaysRaw == null ? null : Number(intervalDaysRaw);
  const noticeDays = noticeDaysRaw === '' || noticeDaysRaw == null ? null : Number(noticeDaysRaw);

  // Live forecast preview, using the same engine the server reports from.
  const preview = React.useMemo(() => {
    if (!/^\d+(\.\d{1,4})?$/.test(amount ?? '')) return null;
    if (cadence === 'CUSTOM_DAYS' && (!intervalDays || intervalDays <= 0)) return null;
    try {
      const schedule = {
        amount: amount as string,
        currency,
        cadence,
        intervalDays,
        nextChargeAt: nextChargeAt ? fromDateInput(nextChargeAt) : new Date(),
      };
      return {
        monthly: monthlyEquivalent(schedule),
        annual: annualizedCost(schedule),
        cancelBy: nextChargeAt
          ? cancellationDeadline(fromDateInput(nextChargeAt), noticeDays)
          : null,
      };
    } catch {
      return null;
    }
  }, [amount, currency, cadence, intervalDays, nextChargeAt, noticeDays]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const result = isEdit
      ? await updateSubscription({ id: subscriptionId!, data: values })
      : await createSubscription(values);

    if (!result.ok) {
      setServerError(result.error);
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          form.setError(field as keyof SubscriptionFormValues, { message: messages[0] });
        }
      }
      return;
    }

    toast.success(isEdit ? 'Subscription updated' : 'Subscription recorded');
    router.push(`/subscriptions/${result.data.id}`);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {serverError ? <Callout tone="danger">{serverError}</Callout> : null}

      <Card>
        <CardHeader>
          <CardTitle>What is being paid for</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Platform" required error={errors.platformId?.message} htmlFor="platformId">
            <Select id="platformId" {...register('platformId')}>
              <option value="">Select a platform…</option>
              {platforms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Plan name" required error={errors.planName?.message} htmlFor="planName">
            <Input id="planName" placeholder="Business annual" {...register('planName')} />
          </Field>

          <Field
            label="Card used"
            error={errors.cardId?.message}
            htmlFor="cardId"
            hint="Linking a card also records it as saved on this platform."
          >
            <Select id="cardId" {...register('cardId')}>
              <option value="">No card linked</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nickname} ···· {c.last4}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Category" htmlFor="category">
            <Select id="category" {...register('category')}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount per charge" required error={errors.amount?.message} htmlFor="amount">
            <Input
              id="amount"
              inputMode="decimal"
              placeholder="0.00"
              className="tabular text-right"
              {...register('amount')}
            />
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

          <Field label="Billing frequency" htmlFor="cadence">
            <Select id="cadence" {...register('cadence')}>
              {CADENCES.map((c) => (
                <option key={c} value={c}>
                  {CADENCE_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>

          {cadence === 'CUSTOM_DAYS' ? (
            <Field
              label="Days between charges"
              required
              error={errors.intervalDays?.message}
              htmlFor="intervalDays"
            >
              <Input
                id="intervalDays"
                inputMode="numeric"
                placeholder="45"
                {...register('intervalDays')}
              />
            </Field>
          ) : null}

          <Field
            label="Next charge date"
            required
            error={errors.nextChargeAt?.message}
            htmlFor="nextChargeAt"
            hint="The billing anchor. Future charges are projected from here."
          >
            <Input id="nextChargeAt" type="date" {...register('nextChargeAt')} />
          </Field>

          <Field label="Started on" required error={errors.startedAt?.message} htmlFor="startedAt">
            <Input id="startedAt" type="date" {...register('startedAt')} />
          </Field>

          <Field label="Trial ends" error={errors.trialEndsAt?.message} htmlFor="trialEndsAt">
            <Input id="trialEndsAt" type="date" {...register('trialEndsAt')} />
          </Field>

          <Field
            label="Ends on"
            error={errors.endsAt?.message}
            htmlFor="endsAt"
            hint="Leave blank for an open-ended subscription."
          >
            <Input id="endsAt" type="date" {...register('endsAt')} />
          </Field>

          <Field
            label="Notice period (days)"
            error={errors.noticeDays?.message}
            htmlFor="noticeDays"
            hint="Used to work out the last day to cancel."
          >
            <Input
              id="noticeDays"
              inputMode="numeric"
              placeholder="30"
              {...register('noticeDays')}
            />
          </Field>

          <Field label="Status" htmlFor="status">
            <Select id="status" {...register('status')}>
              {SUBSCRIPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel('subscription', s)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="space-y-3 sm:col-span-2">
            <label className="border-line flex items-center justify-between gap-4 rounded-lg border px-3.5 py-2.5">
              <span>
                <Label>Renews automatically</Label>
                <span className="text-ink-subtle mt-0.5 block text-xs">
                  When off, the forecast shows one final charge and then stops.
                </span>
              </span>
              <Switch
                checked={autoRenew}
                onCheckedChange={(checked) => setValue('autoRenew', checked, { shouldDirty: true })}
                aria-label="Renews automatically"
              />
            </label>

            <label className="border-line flex items-center justify-between gap-4 rounded-lg border px-3.5 py-2.5">
              <span>
                <Label>Amount includes tax</Label>
                <span className="text-ink-subtle mt-0.5 block text-xs">
                  Recorded for reporting; it does not change the forecast.
                </span>
              </span>
              <Switch
                checked={taxInclusive}
                onCheckedChange={(checked) =>
                  setValue('taxInclusive', checked, { shouldDirty: true })
                }
                aria-label="Amount includes tax"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Forecast</CardTitle>
              <p className="text-ink-subtle mt-0.5 text-xs">
                Expected cost at {cadenceLabel(cadence, intervalDays).toLowerCase()} billing. Not a
                payment.
              </p>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-ink-subtle text-xs">Monthly equivalent</p>
              <CurrencyAmount amount={preview.monthly} currency={currency} size="lg" />
            </div>
            <div>
              <p className="text-ink-subtle text-xs">Annual commitment</p>
              <CurrencyAmount amount={preview.annual} currency={currency} size="lg" />
            </div>
            <div>
              <p className="text-ink-subtle text-xs">Last day to cancel</p>
              <p className="text-ink text-lg font-semibold">
                {preview.cancelBy ? formatDate(preview.cancelBy) : '—'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Attribution</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Client" error={errors.clientId?.message} htmlFor="clientId">
            <Select id="clientId" {...register('clientId')}>
              <option value="">Not client-specific</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Project" error={errors.projectId?.message} htmlFor="projectId">
            <Select id="projectId" {...register('projectId')}>
              <option value="">Not project-specific</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Cost centre" htmlFor="costCenter">
            <Input id="costCenter" {...register('costCenter')} />
          </Field>

          <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
            <Textarea id="notes" rows={2} {...register('notes')} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {isEdit ? 'Save changes' : 'Record subscription'}
        </Button>
      </div>
    </form>
  );
}
