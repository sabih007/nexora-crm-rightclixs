import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission, ROLE_DESCRIPTIONS, ROLE_LABELS, assignableRoles } from '@/lib/permissions';
import { NoAccessState, Callout } from '@/components/ui/empty-state';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { prisma } from '@/lib/db';
import { TeamManager } from '@/features/settings/team-manager';
import { PermissionMatrix } from '@/features/settings/permission-matrix';

export const metadata = { title: 'Team & Roles' };
export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'team:read')) {
    return (
      <>
        <PageHeader title="Team & Roles" />
        <NoAccessState what="the team list" />
      </>
    );
  }

  const memberships = await prisma.membership.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }],
    select: {
      role: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          avatarColor: true,
          status: true,
          mfaEnabled: true,
          lastLoginAt: true,
        },
      },
    },
  });

  const canManage = can(ctx, 'team:update_role');

  return (
    <>
      <PageHeader
        title="Team & Roles"
        description="Who can see and change what in this workspace."
        breadcrumbs={[{ label: 'Nexora OS', href: '/dashboard' }, { label: 'Team & Roles' }]}
      />

      <TeamManager
        members={memberships.map((m) => ({
          id: m.user.id,
          name: m.user.name,
          email: m.user.email,
          avatarColor: m.user.avatarColor,
          status: m.user.status,
          mfaEnabled: m.user.mfaEnabled,
          lastLoginAt: m.user.lastLoginAt,
          role: m.role,
          joinedAt: m.createdAt,
        }))}
        currentUserId={ctx.user.id}
        assignableRoles={assignableRoles(ctx.role)}
        permissions={{
          invite: can(ctx, 'team:invite'),
          updateRole: canManage,
          remove: can(ctx, 'team:remove'),
        }}
      />

      <section className="mt-6">
        <SectionHeader
          title="What each role can do"
          description="Enforced on the server for every action, export and download — not only in the interface."
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(['OWNER', 'ADMIN', 'FINANCE', 'MANAGER', 'STAFF'] as const).map((role) => (
            <Card key={role}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {ROLE_LABELS[role]}
                  {role === ctx.role ? (
                    <Badge tone="brand" size="sm">
                      you
                    </Badge>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs leading-relaxed text-ink-muted">
                  {ROLE_DESCRIPTIONS[role]}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Callout tone="info" className="mt-4">
          Owner, Admin and Finance accounts must clear a two-factor challenge once enrolled,
          because those roles can move money or change who else can. Changing someone&rsquo;s role
          immediately ends their active sessions.
        </Callout>

        <div className="mt-4">
          <PermissionMatrix />
        </div>
      </section>
    </>
  );
}
