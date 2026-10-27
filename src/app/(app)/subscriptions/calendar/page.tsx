import { requireAuthPage } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState, Callout } from '@/components/ui/empty-state';
import { getForecastSummary } from '@/features/subscriptions/queries';
import { RenewalCalendar } from '@/features/subscriptions/renewal-calendar';

export const metadata = { title: 'Renewal calendar' };
export const dynamic = 'force-dynamic';

export default async function RenewalCalendarPage() {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'subscription:read')) {
    return <NoAccessState what="subscriptions" />;
  }

  const forecast = await getForecastSummary(ctx);

  return (
    <>
      <Callout tone="info" className="mb-4">
        Expected charges for the next 90 days, produced by walking each subscription&rsquo;s real
        billing schedule. A weekly plan appears on every one of its dates rather than as a single
        averaged entry. These are forecasts, not payments.
      </Callout>

      <RenewalCalendar
        charges={forecast.upcoming.map((charge) => ({
          ...charge,
          chargeDate: charge.chargeDate.toISOString(),
        }))}
        totals={{ next7: forecast.next7, next30: forecast.next30, next90: forecast.next90 }}
      />
    </>
  );
}
