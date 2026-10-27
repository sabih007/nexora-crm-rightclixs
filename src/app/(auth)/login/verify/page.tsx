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
      <h1 className="text-ink text-2xl font-semibold tracking-tight">Two-factor verification</h1>
      <p className="text-ink-muted mt-1.5 text-sm">
        Enter the six-digit code from your authenticator app for{' '}
        <span className="text-ink font-medium">{ctx.user.email}</span>.
      </p>
      <div className="mt-6">
        <VerifyMfaForm />
      </div>
    </div>
  );
}
