import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState, Callout } from '@/components/ui/empty-state';
import { listCardsWithFootprint, listPlatformOptions } from '@/features/subscriptions/queries';
import { listWorkspaceMembers } from '@/features/projects/queries';
import { CardsBoard } from '@/features/subscriptions/cards-board';

export const metadata = { title: 'Payment cards' };
export const dynamic = 'force-dynamic';

export default async function CardsPage() {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'card:read')) {
    return <NoAccessState what="the payment card inventory" />;
  }

  const [cards, platforms, members] = await Promise.all([
    listCardsWithFootprint(ctx),
    listPlatformOptions(ctx),
    listWorkspaceMembers(ctx),
  ]);

  return (
    <>
      <Callout tone="info" className="mb-4">
        This is an <strong>inventory</strong>, not a wallet. Nexora OS stores only a card&rsquo;s
        last four digits and non-secret details — never the full number, CVV, PIN or any banking
        credential — and it cannot charge a card or change anything on an external platform.
      </Callout>

      <CardsBoard
        cards={cards}
        platforms={platforms}
        members={members.map((m) => ({ id: m.id, name: m.name }))}
        permissions={{
          create: can(ctx, 'card:create'),
          update: can(ctx, 'card:update'),
          delete: can(ctx, 'card:delete'),
          manageLinks: can(ctx, 'platformlink:manage'),
        }}
      />
    </>
  );
}
