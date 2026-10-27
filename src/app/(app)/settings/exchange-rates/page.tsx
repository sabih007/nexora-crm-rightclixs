import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState, Callout } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { getWorkspace } from '@/lib/workspace';
import { listExchangeRates } from '@/features/reports/queries';
import { ExchangeRatesManager } from '@/features/settings/exchange-rates-manager';

export const metadata = { title: 'Exchange rates' };
export const dynamic = 'force-dynamic';

export default async function ExchangeRatesPage() {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'exchangerate:read')) {
    return (
      <>
        <PageHeader title="Exchange rates" />
        <NoAccessState what="exchange rates" />
      </>
    );
  }

  const [rates, workspace] = await Promise.all([
    listExchangeRates(200),
    getWorkspace(ctx.workspaceId),
  ]);

  return (
    <>
      <PageHeader
        title="Exchange rates"
        description="Dated rate snapshots used to consolidate reports into the base currency."
        breadcrumbs={[
          { label: 'Nexora OS', href: '/dashboard' },
          { label: 'Settings', href: '/settings' },
          { label: 'Exchange rates' },
        ]}
      />

      <Callout tone="info" className="mb-5">
        Rates are entered manually and stamped with an effective date. A conversion always uses the
        most recent rate <strong>on or before</strong> the transaction&rsquo;s own date — never
        today&rsquo;s rate applied to last year&rsquo;s invoice. If no suitable rate exists, the
        amount is excluded from the consolidated total and reported separately rather than being
        estimated. No rate provider is connected; nothing is fetched automatically.
      </Callout>

      <ExchangeRatesManager
        rates={rates.map((rate) => ({
          id: rate.id,
          baseCurrency: rate.baseCurrency,
          quoteCurrency: rate.quoteCurrency,
          rate: rate.rate.toString(),
          effectiveDate: rate.effectiveDate,
          source: rate.source,
        }))}
        baseCurrency={workspace.baseCurrency}
        canManage={can(ctx, 'exchangerate:manage')}
      />
    </>
  );
}
