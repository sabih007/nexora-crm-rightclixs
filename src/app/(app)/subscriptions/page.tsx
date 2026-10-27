import Link from 'next/link';
import { CalendarClock, Plus, TrendingUp, Wallet } from 'lucide-react';
import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState, Callout } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { StatCard, StatGrid } from '@/components/shared/stat-card';
import { SectionHeader } from '@/components/shared/page-header';
import { first, parseEnumList, parsePagination, parseSort } from '@/lib/query';
import {
  CADENCES,
  SUBSCRIPTION_SORT_KEYS,
  SUBSCRIPTION_STATUSES,
  subscriptionFilterSchema,
} from '@/features/subscriptions/schemas';
import {
  getForecastSummary,
  listCardOptions,
  listPlatformOptions,
  listSubscriptionCategories,
  listSubscriptions,
} from '@/features/subscriptions/queries';
import { SubscriptionsTable } from '@/features/subscriptions/subscriptions-table';
import { MultiCurrencyAmount } from '@/features/subscriptions/multi-currency-amount';

export const metadata = { title: 'Subscriptions' };
export const dynamic = 'force-dynamic';

export default async function SubscriptionsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'subscription:read')) {
    return <NoAccessState what="subscriptions" />;
  }

  const params = await searchParams;
  const filters = subscriptionFilterSchema.parse({
    search: first(params.search) ?? '',
    status: parseEnumList(params.status, SUBSCRIPTION_STATUSES),
    cadence: parseEnumList(params.cadence, CADENCES),
    cardId: first(params.cardId) ?? '',
    platformId: first(params.platformId) ?? '',
    currency: first(params.currency) ?? '',
    category: first(params.category) ?? '',
    ownerId: first(params.ownerId) ?? '',
    dueWithinDays: first(params.dueWithinDays),
  });

  const pagination = parsePagination(params);
  const sort = parseSort(first(params.sort), SUBSCRIPTION_SORT_KEYS, {
    key: 'nextChargeAt',
    direction: 'asc',
  });

  const [result, forecast, cards, platforms, categories] = await Promise.all([
    listSubscriptions(ctx, filters, pagination, sort),
    getForecastSummary(ctx),
    listCardOptions(ctx),
    listPlatformOptions(ctx),
    listSubscriptionCategories(ctx),
  ]);

  const canCreate = can(ctx, 'subscription:create');

  return (
    <>
      <Callout tone="info" className="mb-4">
        Every figure below is an <strong>expected</strong> charge calculated from each
        subscription&rsquo;s amount and schedule. Money that has actually left the account is
        recorded separately under{' '}
        <Link href="/subscriptions/expenses" className="font-medium underline">
          Expenses
        </Link>
        . Nexora OS never charges a card.
      </Callout>

      <StatGrid className="mb-5">
        <StatCard
          label="Monthly commitment"
          definition="Sum of every active subscription's monthly equivalent: monthly = amount, quarterly = amount / 3, annual = amount / 12, weekly = amount × 52 / 12, custom = amount × (365.25 / interval days) / 12. Grouped by currency; unlike currencies are never added."
          value={<MultiCurrencyAmount amounts={forecast.commitment.monthlyByCurrency} />}
          sublabel={`${forecast.commitment.activeCount} active`}
          icon={TrendingUp}
        />
        <StatCard
          label="Annual commitment"
          definition="Each active subscription's amount multiplied by its number of charges per year, grouped by currency."
          value={<MultiCurrencyAmount amounts={forecast.commitment.annualByCurrency} />}
          icon={Wallet}
        />
        <StatCard
          label="Due in 7 days"
          definition="Expected charges falling in the next 7 days, walked from each subscription's actual billing schedule — not an averaged figure."
          value={<MultiCurrencyAmount amounts={forecast.next7} />}
          tone="warning"
          icon={CalendarClock}
          href="/subscriptions/calendar"
        />
        <StatCard
          label="Due in 30 days"
          definition="Expected charges falling in the next 30 days, from the real schedule of each subscription."
          value={<MultiCurrencyAmount amounts={forecast.next30} />}
          icon={CalendarClock}
          href="/subscriptions/calendar"
        />
      </StatGrid>

      <SectionHeader
        title="All subscriptions"
        description="Filter by card to answer “what is this card paying for?”"
        actions={
          canCreate ? (
            <Button size="sm" asChild>
              <Link href="/subscriptions/new">
                <Plus /> New subscription
              </Link>
            </Button>
          ) : null
        }
      />

      <SubscriptionsTable
        data={result}
        filters={filters}
        sort={sort}
        cards={cards}
        platforms={platforms}
        categories={categories}
        canCreate={canCreate}
      />
    </>
  );
}
