'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Callout } from '@/components/ui/empty-state';
import { CURRENCIES, PRIORITY_CURRENCIES } from '@/lib/money';
import { updateWorkspace } from './actions';

/** Common IANA zones, with the workspace's own value always included. */
const TIMEZONES = [
  'UTC',
  'Asia/Karachi',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Istanbul',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
];

interface WorkspaceValues {
  name: string;
  baseCurrency: string;
  timezone: string;
  invoicePrefix: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
}

export function WorkspaceSettingsForm({
  workspace,
  canEdit,
}: {
  workspace: WorkspaceValues;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = React.useState(workspace);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const currencyChanged = values.baseCurrency !== workspace.baseCurrency;

  function set<K extends keyof WorkspaceValues>(key: K, value: WorkspaceValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await updateWorkspace({
        name: values.name,
        baseCurrency: values.baseCurrency,
        timezone: values.timezone,
        invoicePrefix: values.invoicePrefix,
        addressLine1: values.addressLine1 ?? '',
        addressLine2: values.addressLine2 ?? '',
        city: values.city ?? '',
        postalCode: values.postalCode ?? '',
        country: values.country ?? '',
        taxId: values.taxId ?? '',
        email: values.email ?? '',
        phone: values.phone ?? '',
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success('Workspace updated');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const timezoneOptions = TIMEZONES.includes(workspace.timezone)
    ? TIMEZONES
    : [workspace.timezone, ...TIMEZONES];

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardContent className="space-y-4 pt-5">
          {error ? <Callout tone="danger">{error}</Callout> : null}

          {currencyChanged ? (
            <Callout tone="warning" title="Changing the base currency">
              Every consolidated report is re-expressed in {values.baseCurrency}. Historic
              transactions keep their original currency and amount; only the converted totals
              change, and they will need exchange rates covering their dates.
            </Callout>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Workspace name" required htmlFor="ws-name">
              <Input
                id="ws-name"
                value={values.name}
                onChange={(e) => set('name', e.target.value)}
                disabled={!canEdit}
              />
            </Field>

            <Field
              label="Base currency"
              required
              htmlFor="ws-currency"
              hint="Used for consolidated report totals."
            >
              <Select
                id="ws-currency"
                value={values.baseCurrency}
                onChange={(e) => set('baseCurrency', e.target.value)}
                disabled={!canEdit}
              >
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
              label="Timezone"
              required
              htmlFor="ws-timezone"
              hint="Reminder jobs use this to decide what 'today' means."
            >
              <Select
                id="ws-timezone"
                value={values.timezone}
                onChange={(e) => set('timezone', e.target.value)}
                disabled={!canEdit}
              >
                {timezoneOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Invoice prefix"
              required
              htmlFor="ws-prefix"
              hint="Invoice numbers look like PREFIX-YEAR-0001."
            >
              <Input
                id="ws-prefix"
                value={values.invoicePrefix}
                onChange={(e) => set('invoicePrefix', e.target.value.toUpperCase())}
                disabled={!canEdit}
                className="font-mono"
              />
            </Field>

            <Field label="Billing email" htmlFor="ws-email">
              <Input
                id="ws-email"
                type="email"
                value={values.email ?? ''}
                onChange={(e) => set('email', e.target.value)}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Phone" htmlFor="ws-phone">
              <Input
                id="ws-phone"
                type="tel"
                value={values.phone ?? ''}
                onChange={(e) => set('phone', e.target.value)}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Tax identifier" htmlFor="ws-tax" hint="Printed on invoices.">
              <Input
                id="ws-tax"
                value={values.taxId ?? ''}
                onChange={(e) => set('taxId', e.target.value)}
                disabled={!canEdit}
              />
            </Field>
          </div>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="text-ink mb-1 text-[13px] font-medium">Address on invoices</legend>
            <Field label="Address line 1" htmlFor="ws-line1" className="sm:col-span-2">
              <Input
                id="ws-line1"
                value={values.addressLine1 ?? ''}
                onChange={(e) => set('addressLine1', e.target.value)}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Address line 2" htmlFor="ws-line2" className="sm:col-span-2">
              <Input
                id="ws-line2"
                value={values.addressLine2 ?? ''}
                onChange={(e) => set('addressLine2', e.target.value)}
                disabled={!canEdit}
              />
            </Field>
            <Field label="City" htmlFor="ws-city">
              <Input
                id="ws-city"
                value={values.city ?? ''}
                onChange={(e) => set('city', e.target.value)}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Postal code" htmlFor="ws-postal">
              <Input
                id="ws-postal"
                value={values.postalCode ?? ''}
                onChange={(e) => set('postalCode', e.target.value)}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Country" htmlFor="ws-country">
              <Input
                id="ws-country"
                value={values.country ?? ''}
                onChange={(e) => set('country', e.target.value)}
                disabled={!canEdit}
              />
            </Field>
          </fieldset>
        </CardContent>

        {canEdit ? (
          <CardFooter className="justify-end">
            <Button type="submit" loading={busy}>
              Save workspace
            </Button>
          </CardFooter>
        ) : (
          <CardFooter>
            <p className="text-ink-subtle text-xs">
              Your role can view these settings but not change them.
            </p>
          </CardFooter>
        )}
      </Card>
    </form>
  );
}
