import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState } from '@/components/ui/empty-state';
import { listCardOptions, listPlatformsWithLinks } from '@/features/subscriptions/queries';
import { listWorkspaceMembers } from '@/features/projects/queries';
import { PlatformsBoard } from '@/features/subscriptions/platforms-board';

export const metadata = { title: 'Platforms' };
export const dynamic = 'force-dynamic';

export default async function PlatformsPage() {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'platform:read')) {
    return <NoAccessState what="the platform registry" />;
  }

  const [platforms, cards, members] = await Promise.all([
    listPlatformsWithLinks(ctx),
    listCardOptions(ctx),
    listWorkspaceMembers(ctx),
  ]);

  return (
    <PlatformsBoard
      platforms={platforms}
      cards={cards}
      members={members.map((m) => ({ id: m.id, name: m.name }))}
      permissions={{
        create: can(ctx, 'platform:create'),
        update: can(ctx, 'platform:update'),
        delete: can(ctx, 'platform:delete'),
        manageLinks: can(ctx, 'platformlink:manage'),
      }}
    />
  );
}
