'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { Callout } from '@/components/ui/empty-state';
import { changePassword } from '@/features/auth/actions';
import { cn } from '@/lib/utils';

/** Password change, with the same rules the server enforces shown live. */
export function PasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  const rules = [
    { label: 'At least 12 characters', met: newPassword.length >= 12 },
    { label: 'A lower-case letter', met: /[a-z]/.test(newPassword) },
    { label: 'An upper-case letter', met: /[A-Z]/.test(newPassword) },
    { label: 'A number', met: /\d/.test(newPassword) },
  ];

  const allMet = rules.every((rule) => rule.met);
  const matches = newPassword.length > 0 && newPassword === confirmPassword;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      const result = await changePassword({ currentPassword, newPassword, confirmPassword });
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      toast.success('Password changed', {
        description: 'Every other device has been signed out.',
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardContent className="space-y-4 pt-5">
          {error ? <Callout tone="danger">{error}</Callout> : null}

          <Field
            label="Current password"
            required
            error={fieldErrors.currentPassword}
            htmlFor="current-password"
          >
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="New password"
              required
              error={fieldErrors.newPassword}
              htmlFor="new-password"
            >
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </Field>

            <Field
              label="Confirm new password"
              required
              error={
                confirmPassword && !matches
                  ? 'The two passwords do not match.'
                  : fieldErrors.confirmPassword
              }
              htmlFor="confirm-password"
            >
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </Field>
          </div>

          <ul className="grid gap-1 sm:grid-cols-2" aria-label="Password requirements">
            {rules.map((rule) => (
              <li
                key={rule.label}
                className={cn(
                  'flex items-center gap-1.5 text-xs',
                  rule.met ? 'text-success' : 'text-ink-subtle',
                )}
              >
                {rule.met ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <X className="size-3.5" aria-hidden />
                )}
                {rule.label}
                <span className="sr-only">{rule.met ? ' — met' : ' — not yet met'}</span>
              </li>
            ))}
          </ul>
        </CardContent>

        <CardFooter className="justify-between">
          <p className="text-xs text-ink-subtle">
            Hashed with argon2id. Other sessions end immediately.
          </p>
          <Button
            type="submit"
            loading={busy}
            disabled={!currentPassword || !allMet || !matches}
          >
            Change password
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
