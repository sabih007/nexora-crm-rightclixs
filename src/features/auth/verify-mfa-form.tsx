'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Callout } from '@/components/ui/empty-state';
import { verifyMfa } from './actions';

export function VerifyMfaForm() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [useRecovery, setUseRecovery] = React.useState(false);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '');
    setError(null);

    startTransition(async () => {
      const result = await verifyMfa({ code, useRecoveryCode: useRecovery });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push('/dashboard');
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Callout tone="danger">{error}</Callout> : null}

      <Field
        label={useRecovery ? 'Recovery code' : 'Authentication code'}
        required
        htmlFor="code"
        hint={useRecovery ? 'Each recovery code works once.' : 'The code changes every 30 seconds.'}
      >
        <Input
          id="code"
          name="code"
          autoFocus
          autoComplete="one-time-code"
          inputMode={useRecovery ? 'text' : 'numeric'}
          placeholder={useRecovery ? 'XXXXX-XXXXX' : '000000'}
          maxLength={useRecovery ? 11 : 6}
          className={
            useRecovery ? 'font-mono tracking-wider' : 'font-mono text-lg tracking-[0.35em]'
          }
          required
        />
      </Field>

      <Button type="submit" className="w-full" size="lg" loading={pending}>
        Verify
      </Button>

      <button
        type="button"
        onClick={() => {
          setUseRecovery((v) => !v);
          setError(null);
        }}
        className="text-brand-500 focus-visible:ring-brand-500/40 w-full rounded text-center text-xs hover:underline focus-visible:ring-2 focus-visible:outline-none"
      >
        {useRecovery ? 'Use an authenticator code instead' : 'Use a recovery code instead'}
      </button>
    </form>
  );
}
