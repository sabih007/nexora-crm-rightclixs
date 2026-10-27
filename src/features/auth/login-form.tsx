'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Callout } from '@/components/ui/empty-state';
import { login } from './actions';

export function LoginForm() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [showPassword, setShowPassword] = React.useState(false);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await login({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
      });

      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }

      router.push(result.data.status === 'mfa_required' ? '/login/verify' : '/dashboard');
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? (
        <Callout tone="danger">
          <span className="flex items-start gap-1.5">
            <ShieldAlert className="mt-px size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </span>
        </Callout>
      ) : null}

      <Field label="Email address" error={fieldErrors.email} required htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          placeholder="you@office.com"
        />
      </Field>

      <Field label="Password" error={fieldErrors.password} required htmlFor="password">
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="text-ink-subtle hover:text-ink focus-visible:ring-brand-500/40 absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>

      <Button type="submit" className="w-full" size="lg" loading={pending}>
        Sign in
      </Button>

      <p className="text-ink-subtle text-center text-[11px] leading-relaxed">
        Accounts are created by a workspace administrator. If you cannot sign in, ask them to reset
        your password.
      </p>
    </form>
  );
}
