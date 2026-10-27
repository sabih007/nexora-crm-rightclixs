import { requireAuthPage } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState, Callout } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { prisma } from '@/lib/db';
import { first, parsePagination, skipTake, escapeLike } from '@/lib/query';
import { ActivityLog } from '@/features/settings/activity-log';

export const metadata = { title: 'Activity Log' };
export const dynamic = 'force-dynamic';

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'audit:read')) {
    return (
      <>
        <PageHeader title="Activity Log" />
        <NoAccessState what="the activity log" />
      </>
    );
  }

  const params = await searchParams;
  const pagination = parsePagination(params);
  const search = first(params.search) ?? '';
  const entityType = first(params.entityType) ?? '';
  const actorId = first(params.actorId) ?? '';

  const where = {
    workspaceId: ctx.workspaceId,
    ...(entityType ? { entityType } : {}),
    ...(actorId ? { actorId } : {}),
    ...(search
      ? {
          OR: [
            { action: { contains: escapeLike(search), mode: 'insensitive' as const } },
            { summary: { contains: escapeLike(search), mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [entries, total, actors, entityTypes] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...skipTake(pagination),
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        summary: true,
        createdAt: true,
        actor: { select: { id: true, name: true, avatarColor: true } },
      },
    }),
    prisma.auditLog.count({ where }),
    prisma.membership.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
    prisma.auditLog.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { entityType: true },
      distinct: ['entityType'],
      orderBy: { entityType: 'asc' },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Activity Log"
        description="Every financial change, role change and export, with who did it and when."
        breadcrumbs={[{ label: 'Nexora OS', href: '/dashboard' }, { label: 'Activity Log' }]}
      />

      <Callout tone="info" className="mb-4">
        Audit entries are written as part of the same transaction as the change they describe.
        Secrets, passwords, card numbers and file contents are never recorded.
      </Callout>

      <ActivityLog
        entries={entries}
        total={total}
        page={pagination.page}
        pageSize={pagination.pageSize}
        filters={{ search, entityType, actorId }}
        actors={actors.map((a) => a.user)}
        entityTypes={entityTypes.map((e) => e.entityType)}
      />
    </>
  );
}
