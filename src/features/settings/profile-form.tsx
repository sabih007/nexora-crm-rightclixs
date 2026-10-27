'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Field, Input, Label, Select } from '@/components/ui/field';
import { Switch } from '@/components/ui/misc';
import { Callout } from '@/components/ui/empty-state';
import { updateProfile } from './actions';

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

export function ProfileForm({
  defaults,
  email,
}: {
  defaults: { name: string; timezone: string | null; emailOptOut: boolean };
  email: string;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(defaults.name);
  const [timezone, setTimezone] = React.useState(defaults.timezone ?? '');
  const [emailOptOut, setEmailOptOut] = React.useState(defaults.emailOptOut);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await updateProfile({ name, timezone: timezone || null, emailOptOut });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success('Profile updated');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const timezoneOptions =
    defaults.timezone && !TIMEZONES.includes(defaults.timezone)
      ? [defaults.timezone, ...TIMEZONES]
      : TIMEZONES;

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardContent className="space-y-4 pt-5">
          {error ? <Callout tone="danger">{error}</Callout> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required htmlFor="profile-name">
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field
              label="Email"
              htmlFor="profile-email"
              hint="Your sign-in address. Ask an administrator to change it."
            >
              <Input id="profile-email" value={email} disabled readOnly />
            </Field>

            <Field
              label="Timezone"
              htmlFor="profile-timezone"
              hint="Used when showing dates and times to you."
            >
              <Select
                id="profile-timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                <option value="">Use the workspace timezone</option>
                {timezoneOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <label className="flex items-center justify-between gap-4 rounded-lg border border-line px-3.5 py-2.5">
            <span>
              <Label>Do not email me</Label>
              <span className="mt-0.5 block text-xs text-ink-subtle">
                Renewal and overdue reminders still appear in the app; only email is suppressed.
              </span>
            </span>
            <Switch
              checked={emailOptOut}
              onCheckedChange={setEmailOptOut}
              aria-label="Do not email me"
            />
          </label>
        </CardContent>

        <CardFooter className="justify-end">
          <Button type="submit" loading={busy}>
            Save profile
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
