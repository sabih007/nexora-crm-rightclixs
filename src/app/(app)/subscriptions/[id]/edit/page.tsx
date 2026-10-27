import { notFound } from 'next/navigation';
import { requireAuthPage } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState } from '@/components/ui/empty-state';
import { SubscriptionForm } from '@/features/subscriptions/subscription-form';
import {
  getSubscriptionDetail,
  listCardOptions,
  listPlatformOptions,
} from '@/features/subscriptions/queries';
import { listClientOptions } from '@/features/clients/queries';
import { getWorkspace } from '@/lib/workspace';
import { prisma } from '@/lib/db';
import { toDateInput } from '@/lib/dates';

export const metadata = { title: 'Edit subscription' };
export const dynamic = 'force-dynamic';

export default async function EditSubscriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'subscription:update')) {
    return <NoAccessState what="subscription editing" />;
  }

  const [subscription, platforms, cards, clients, projects, workspace] = await Promise.all([
    getSubscriptionDetail(ctx, id),
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

  if (!subscription) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <SubscriptionForm
        subscriptionId={subscription.id}
        platforms={platforms}
        cards={cards}
        clients={clients}
        projects={projects}
        workspaceCurrency={workspace.baseCurrency}
        defaults={{
          platformId: subscription.platformId,
          cardId: subscription.cardId,
          projectId: subscription.projectId,
          clientId: subscription.clientId,
          planName: subscription.planName,
          amount: subscription.amount.toString(),
          currency: subscription.currency,
          cadence: subscription.cadence,
          intervalDays: subscription.intervalDays ?? '',
          nextChargeAt: toDateInput(subscription.nextChargeAt),
          startedAt: toDateInput(subscription.startedAt),
          endsAt: toDateInput(subscription.endsAt),
          trialEndsAt: toDateInput(subscription.trialEndsAt),
          autoRenew: subscription.autoRenew,
          status: subscription.status,
          category: subscription.category,
          costCenter: subscription.costCenter,
          noticeDays: subscription.noticeDays ?? '',
          taxInclusive: subscription.taxInclusive,
          notes: subscription.notes,
        }}
      />
    </div>
  );
}
