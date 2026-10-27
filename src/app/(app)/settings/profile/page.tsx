import { requireAuthPage } from '@/lib/auth/guard';
import { roleRequiresMfa, ROLE_LABELS } from '@/lib/permissions';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/empty-state';
import { prisma } from '@/lib/db';
import { ProfileForm } from '@/features/settings/profile-form';
import { PasswordForm } from '@/features/settings/password-form';
import { MfaPanel } from '@/features/settings/mfa-panel';
import { formatDateTime } from '@/lib/dates';

export const metadata = { title: 'Profile & security' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const ctx = await requireAuthPage();

  const [user, sessions] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: ctx.user.id },
      select: {
        name: true,
        email: true,
        timezone: true,
        emailOptOut: true,
        mfaEnabled: true,
        mfaEnrolledAt: true,
        mfaRecoveryCodes: true,
        passwordChangedAt: true,
        lastLoginAt: true,
      },
    }),
    prisma.session.findMany({
      where: { userId: ctx.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, userAgent: true, lastSeenAt: true, createdAt: true },
      take: 10,
    }),
  ]);

  const mfaRequired = roleRequiresMfa(ctx.role);
  const remainingRecoveryCodes = Array.isArray(user.mfaRecoveryCodes)
    ? (user.mfaRecoveryCodes as string[]).length
    : 0;

  return (
    <>
      <PageHeader
        title="Profile & security"
        description="Your account details, password and two-factor authentication."
        breadcrumbs={[
          { label: 'Nexora OS', href: '/dashboard' },
          { label: 'Settings', href: '/settings' },
          { label: 'Profile' },
        ]}
        badge={<Badge tone="brand">{ROLE_LABELS[ctx.role]}</Badge>}
      />

      {mfaRequired && !user.mfaEnabled ? (
        <Callout
          tone="warning"
          title="Two-factor authentication is required for your role"
          className="mb-5"
        >
          As {ROLE_LABELS[ctx.role]} you can move money or change who else can. Enrol below — once
          you do, signing in will ask for a code from your authenticator app.
        </Callout>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-5">
          <section>
            <SectionHeader title="Your details" />
            <ProfileForm
              defaults={{
                name: user.name,
                timezone: user.timezone,
                emailOptOut: user.emailOptOut,
              }}
              email={user.email}
            />
          </section>

          <section>
            <SectionHeader
              title="Two-factor authentication"
              description="A time-based code from an authenticator app, in addition to your password."
            />
            <MfaPanel
              enabled={user.mfaEnabled}
              enrolledAt={user.mfaEnrolledAt}
              required={mfaRequired}
              remainingRecoveryCodes={remainingRecoveryCodes}
            />
          </section>

          <section>
            <SectionHeader
              title="Password"
              description="Changing it signs out every other device."
            />
            <PasswordForm />
          </section>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Email" value={user.email} />
              <Row label="Role" value={ROLE_LABELS[ctx.role]} />
              <Row
                label="Last sign-in"
                value={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'This is your first'}
              />
              <Row
                label="Password changed"
                value={
                  user.passwordChangedAt ? formatDateTime(user.passwordChangedAt) : 'Never changed'
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active sessions</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2.5">
                {sessions.map((session) => (
                  <li key={session.id} className="text-xs">
                    <p className="flex items-center gap-1.5">
                      <span className="text-ink truncate">
                        {describeUserAgent(session.userAgent)}
                      </span>
                      {session.id === ctx.sessionId ? (
                        <Badge tone="success" size="sm">
                          this device
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-ink-subtle">
                      last active {formatDateTime(session.lastSeenAt)}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="border-line text-ink-subtle mt-3 border-t pt-2.5 text-[11px]">
                Changing your password ends every session except this one.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-subtle shrink-0">{label}</span>
      <span className="text-ink min-w-0 truncate text-right">{value}</span>
    </div>
  );
}

/** A readable device name from a user-agent string. */
function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : /Firefox\//.test(userAgent)
            ? 'Firefox'
            : 'Browser';
  const platform = /Windows/.test(userAgent)
    ? 'Windows'
    : /Macintosh|Mac OS/.test(userAgent)
      ? 'macOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /iPhone|iPad/.test(userAgent)
          ? 'iOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : '';
  return platform ? `${browser} on ${platform}` : browser;
}
