import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { roleRequiresMfa } from '@/lib/permissions';
import { prisma } from '@/lib/db';
import { isDevelopment } from '@/lib/env';
import { LoginForm } from '@/features/auth/login-form';
import { Callout } from '@/components/ui/empty-state';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const ctx = await getAuthContext();
  if (ctx) {
    if (roleRequiresMfa(ctx.role) && ctx.user.mfaEnabled && !ctx.mfaSatisfied) {
      redirect('/login/verify');
    }
    redirect('/dashboard');
  }

  // First-run guidance: an empty user table means nobody has bootstrapped yet.
  const userCount = await prisma.user.count();

  return (
    <div>
      <h1 className="text-ink text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="text-ink-muted mt-1.5 text-sm">
        Use your Nexora OS office account to continue.
      </p>

      {userCount === 0 ? (
        <Callout tone="warning" title="No accounts exist yet" className="mt-5">
          Create the first Owner account by running{' '}
          <code className="bg-surface-sunken rounded px-1 py-0.5 font-mono text-[11px]">
            npm run bootstrap:admin
          </code>
          .
        </Callout>
      ) : null}

      <div className="mt-6">
        <LoginForm />
      </div>

      {isDevelopment ? (
        <p className="text-ink-subtle mt-6 text-[11px] leading-relaxed">
          Development build. Seeded demo accounts use the password printed by{' '}
          <code className="font-mono">npm run db:seed</code>.
        </p>
      ) : null}
    </div>
  );
}
