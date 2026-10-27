'use client';

import * as React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Copy, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/field';
import { Callout } from '@/components/ui/empty-state';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { beginMfaEnrolment, completeMfaEnrolment, disableMfa } from '@/features/auth/actions';
import { formatDateTime } from '@/lib/dates';

/**
 * Two-factor enrolment.
 *
 * The secret is not persisted until the user proves they can generate a
 * valid code from it, so an abandoned enrolment leaves the account exactly
 * as it was. Recovery codes are shown once and stored only as hashes.
 */
export function MfaPanel({
  enabled,
  enrolledAt,
  required,
  remainingRecoveryCodes,
}: {
  enabled: boolean;
  enrolledAt: Date | null;
  required: boolean;
  remainingRecoveryCodes: number;
}) {
  const [enrolOpen, setEnrolOpen] = React.useState(false);
  const [disableOpen, setDisableOpen] = React.useState(false);

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-start gap-3">
          <span
            className={
              enabled
                ? 'bg-success-soft text-success flex size-9 items-center justify-center rounded-full'
                : 'bg-surface-sunken text-ink-subtle flex size-9 items-center justify-center rounded-full'
            }
            aria-hidden
          >
            {enabled ? <ShieldCheck className="size-4.5" /> : <ShieldOff className="size-4.5" />}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-ink flex flex-wrap items-center gap-2 text-sm font-medium">
              {enabled ? 'Two-factor authentication is on' : 'Two-factor authentication is off'}
              {required ? (
                <Badge tone={enabled ? 'success' : 'warning'} size="sm">
                  required for your role
                </Badge>
              ) : null}
            </p>
            <p className="text-ink-subtle mt-0.5 text-xs">
              {enabled
                ? `Enrolled ${enrolledAt ? formatDateTime(enrolledAt) : 'previously'}. ${remainingRecoveryCodes} recovery code${remainingRecoveryCodes === 1 ? '' : 's'} left.`
                : 'Protects the account even if your password is stolen.'}
            </p>
          </div>
        </div>

        {enabled && remainingRecoveryCodes <= 2 ? (
          <Callout tone="warning" className="mt-3">
            Only {remainingRecoveryCodes} recovery code
            {remainingRecoveryCodes === 1 ? '' : 's'} remain. Turn two-factor off and on again to
            issue a fresh set before you run out.
          </Callout>
        ) : null}
      </CardContent>

      <CardFooter className="justify-end">
        {enabled ? (
          required ? (
            <p className="text-ink-subtle text-xs">
              Two-factor cannot be turned off for your role.
            </p>
          ) : (
            <Button variant="danger-outline" onClick={() => setDisableOpen(true)}>
              Turn off
            </Button>
          )
        ) : (
          <Button onClick={() => setEnrolOpen(true)}>
            <ShieldCheck /> Set up two-factor
          </Button>
        )}
      </CardFooter>

      <EnrolDialog open={enrolOpen} onOpenChange={setEnrolOpen} />
      <DisableDialog open={disableOpen} onOpenChange={setDisableOpen} />
    </Card>
  );
}

function EnrolDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [secret, setSecret] = React.useState<string | null>(null);
  const [qr, setQr] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Mint the secret when the dialog opens. It is not stored server-side
  // until the verification step succeeds.
  const [primed, setPrimed] = React.useState(false);
  if (open && !primed) {
    setPrimed(true);
    void (async () => {
      const result = await beginMfaEnrolment();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSecret(result.data.secret);
      setQr(result.data.qrDataUrl);
    })();
  }
  if (!open && primed) {
    setPrimed(false);
    setSecret(null);
    setQr(null);
    setCode('');
    setRecoveryCodes(null);
    setError(null);
  }

  async function handleVerify() {
    if (!secret) return;
    setError(null);
    setBusy(true);
    try {
      const result = await completeMfaEnrolment({ secret, code });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRecoveryCodes(result.data.recoveryCodes);
      toast.success('Two-factor authentication is on');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function copyCodes() {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      toast.success('Recovery codes copied');
    } catch {
      toast.error('Could not copy. Select the codes and copy them manually.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {recoveryCodes ? 'Save your recovery codes' : 'Set up two-factor authentication'}
          </DialogTitle>
          <DialogDescription>
            {recoveryCodes
              ? 'Each code works once if you lose access to your authenticator app.'
              : 'Scan the code with an authenticator app, then enter the six digits it shows.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {error ? <Callout tone="danger">{error}</Callout> : null}

          {recoveryCodes ? (
            <>
              <Callout tone="warning">
                These are shown <strong>once</strong>. They are stored only as hashes and cannot be
                displayed again. Keep them somewhere safe and separate from your password.
              </Callout>
              <ul className="border-line bg-surface-sunken grid grid-cols-2 gap-1.5 rounded-lg border p-3">
                {recoveryCodes.map((recoveryCode) => (
                  <li key={recoveryCode} className="tabular text-ink font-mono text-sm">
                    {recoveryCode}
                  </li>
                ))}
              </ul>
              <Button variant="secondary" onClick={copyCodes} className="w-full">
                <Copy /> Copy all codes
              </Button>
            </>
          ) : (
            <>
              {qr ? (
                <div className="border-line flex justify-center rounded-lg border bg-white p-3">
                  {/* Data URL produced server-side by the qrcode library. */}
                  <Image
                    src={qr}
                    alt="QR code for enrolling this account in your authenticator app"
                    width={200}
                    height={200}
                    unoptimized
                  />
                </div>
              ) : (
                <p className="text-ink-subtle py-8 text-center text-sm">Preparing…</p>
              )}

              {secret ? (
                <div className="border-line bg-surface-sunken rounded-lg border px-3 py-2.5">
                  <p className="text-ink-subtle flex items-center gap-1.5 text-xs">
                    <KeyRound className="size-3" aria-hidden /> Or enter this key manually
                  </p>
                  <code className="text-ink mt-1 block font-mono text-xs break-all">{secret}</code>
                </div>
              ) : null}

              <Field label="Code from your app" required htmlFor="mfa-code">
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="font-mono text-lg tracking-[0.35em]"
                />
              </Field>
            </>
          )}
        </DialogBody>

        <DialogFooter>
          {recoveryCodes ? (
            <Button onClick={() => onOpenChange(false)}>I have saved them</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleVerify} loading={busy} disabled={code.length !== 6 || !secret}>
                Verify and turn on
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisableDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleDisable() {
    setError(null);
    setBusy(true);
    try {
      const result = await disableMfa({ password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success('Two-factor authentication turned off');
      setPassword('');
      onOpenChange(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Turn off two-factor authentication?</DialogTitle>
          <DialogDescription>
            Your account will be protected by its password alone.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <Field label="Confirm your password" required htmlFor="disable-password">
            <Input
              id="disable-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDisable} loading={busy} disabled={!password}>
            Turn off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
