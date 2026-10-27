import { requireAuthPage } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState } from '@/components/ui/empty-state';
import { SubscriptionForm } from '@/features/subscriptions/subscription-form';
import { listCardOptions, listPlatformOptions } from '@/features/subscriptions/queries';
import { listClientOptions } from '@/features/clients/queries';
import { getWorkspace } from '@/lib/workspace';
import { prisma } from '@/lib/db';

export const metadata = { title: 'New subscription' };
export const dynamic = 'force-dynamic';

export default async function NewSubscriptionPage() {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'subscription:create')) {
    return <NoAccessState what="subscription creation" />;
  }

  const [platforms, cards, clients, projects, workspace] = await Promise.all([
    listPlatformOptions(ctx),
    listCardOptions(ctx),
    listClientOptions(ctx),
    prisma.project.findMany({
      where: { workspaceId: ctx.workspaceId, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 500,
    }),
    getWorkspace(ctx.workspaceId),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <SubscriptionForm
        platforms={platforms}
        cards={cards}
        clients={clients}
        projects={projects}
        workspaceCurrency={workspace.baseCurrency}
      />
    </div>
  );
}
