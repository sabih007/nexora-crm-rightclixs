import { requireAuthPage } from '@/lib/auth/guard';
import { roleHasAnyPermission } from '@/lib/permissions';
import { NoAccessState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { SubscriptionTabs } from '@/features/subscriptions/subscription-tabs';

export const dynamic = 'force-dynamic';

/**
 * Shared chrome for the subscriptions area: one header plus a tab strip
 * across Overview / Cards / Platforms / Calendar / Expenses.
 */
export default async function SubscriptionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireAuthPage();

  if (!roleHasAnyPermission(ctx.role, ['subscription:read', 'card:read', 'platform:read'])) {
    return (
      <>
        <PageHeader title="Subscriptions" />
        <NoAccessState what="subscriptions and the card inventory" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Recurring commitments, where each card is saved, and what is due next."
        breadcrumbs={[
          { label: 'Nexora OS', href: '/dashboard' },
          { label: 'Subscriptions' },
        ]}
      />
      <SubscriptionTabs role={ctx.role} />
      <div className="mt-5">{children}</div>
    </>
  );
}
