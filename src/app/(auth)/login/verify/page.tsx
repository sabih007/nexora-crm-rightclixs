import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { VerifyMfaForm } from '@/features/auth/verify-mfa-form';

export const dynamic = 'force-dynamic';

export default async function VerifyMfaPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');
  if (ctx.mfaSatisfied) redirect('/dashboard');

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Two-factor verification</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Enter the six-digit code from your authenticator app for{' '}
        <span className="font-medium text-ink">{ctx.user.email}</span>.
      </p>
      <div className="mt-6">
        <VerifyMfaForm />
      </div>
    </div>
  );
}
