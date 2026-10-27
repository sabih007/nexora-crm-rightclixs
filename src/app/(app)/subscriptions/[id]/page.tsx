import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, CreditCard, ExternalLink, Pencil } from 'lucide-react';
import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState, Callout, EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/shared/status-badge';
import { CurrencyAmount } from '@/components/shared/currency-amount';
import { getSubscriptionDetail } from '@/features/subscriptions/queries';
import { annualizedCost, cadenceLabel, type Cadence } from '@/features/subscriptions/forecast';
import { RecordChargeButton } from '@/features/subscriptions/record-charge-button';
import { daysUntil, formatDate, formatDateTime } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAuthPage();
  const subscription = await getSubscriptionDetail(ctx, id);
  return { title: subscription ? `${subscription.platform.name} — ${subscription.planName}` : 'Subscription' };
}

export default async function SubscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAuthPage();

  if (!roleHasPermission(ctx.role, 'subscription:read')) {
    return <NoAccessState what="subscriptions" />;
  }

  const subscription = await getSubscriptionDetail(ctx, id);
  if (!subscription) notFound();

  const annual = annualizedCost({
    amount: subscription.amount.toString(),
    currency: subscription.currency,
    cadence: subscription.cadence,
    intervalDays: subscription.intervalDays,
    nextChargeAt: subscription.nextChargeAt,
  });

  const cancelDays = subscription.cancelBy ? daysUntil(subscription.cancelBy) : null;
  const isBilling = ['ACTIVE', 'TRIAL'].includes(subscription.status);

  return (
    <>
      <PageHeader
        className="mt-1"
        title={`${subscription.platform.name} — ${subscription.planName}`}
        breadcrumbs={[
          { label: 'Subscriptions', href: '/subscriptions' },
          { label: subscription.platform.name },
        ]}
        badge={
          <>
            <StatusBadge kind="subscription" value={subscription.status} />
            <Badge tone="outline">{subscription.category}</Badge>
            {!subscription.autoRenew ? <Badge tone="warning">No auto-renew</Badge> : null}
          </>
        }
        actions={
          <>
            {can(ctx, 'expense:create') && isBilling ? (
              <RecordChargeButton
                subscriptionId={subscription.id}
                defaultAmount={subscription.amount.toString()}
                currency={subscription.currency}
                nextChargeAt={subscription.nextChargeAt.toISOString().slice(0, 10)}
                cadenceDescription={cadenceLabel(
                  subscription.cadence as Cadence,
                  subscription.intervalDays,
                )}
              />
            ) : null}
            {can(ctx, 'subscription:update') ? (
              <Button variant="secondary" asChild>
                <Link href={`/subscriptions/${subscription.id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {cancelDays !== null && cancelDays >= 0 && cancelDays <= 30 && isBilling ? (
        <Callout tone="warning" title="Cancellation notice period" className="mb-4">
          <span className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              This plan needs {subscription.noticeDays} days&rsquo; notice. To avoid the charge on{' '}
              {formatDate(subscription.nextChargeAt)}, cancel by{' '}
              <strong>{formatDate(subscription.cancelBy)}</strong> —{' '}
              {cancelDays === 0 ? 'today' : `${cancelDays} days away`}.
            </span>
          </span>
        </Callout>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Forecast</CardTitle>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  Expected cost derived from the amount and schedule. Not money paid.
                </p>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-ink-subtle">Per charge</p>
                <CurrencyAmount
                  amount={subscription.amount.toString()}
                  currency={subscription.currency}
                  size="lg"
                />
                <p className="mt-0.5 text-[11px] text-ink-subtle">
                  {cadenceLabel(subscription.cadence as Cadence, subscription.intervalDays)}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-subtle">Monthly equivalent</p>
                <CurrencyAmount
                  amount={subscription.monthlyEquivalent}
                  currency={subscription.currency}
                  size="lg"
                />
              </div>
              <div>
                <p className="text-xs text-ink-subtle">Annual commitment</p>
                <CurrencyAmount amount={annual} currency={subscription.currency} size="lg" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Actual charges paid</CardTitle>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  Real expenses recorded against this subscription — separate from the forecast
                  above.
                </p>
              </div>
            </CardHeader>
            <CardContent>
              {subscription.expenses.length === 0 ? (
                <EmptyState
                  title="No charges recorded yet"
                  description="When a charge actually hits the card, record it so the spend history is real rather than assumed."
                  compact
                />
              ) : (
                <ul className="divide-y divide-[var(--line)]">
                  {subscription.expenses.map((expense) => (
                    <li
                      key={expense.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                    >
                      <span className="text-sm text-ink">{formatDate(expense.paidAt)}</span>
                      {expense.reference ? (
                        <span className="truncate text-xs text-ink-subtle">
                          ref {expense.reference}
                        </span>
                      ) : null}
                      <CurrencyAmount
                        amount={expense.amount.toString()}
                        currency={expense.currency}
                        className="ml-auto font-medium"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {subscription.reminders.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Reminders sent</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-[var(--line)]">
                  {subscription.reminders.map((reminder) => (
                    <li
                      key={reminder.id}
                      className="flex items-center gap-3 py-2 text-sm first:pt-0 last:pb-0"
                    >
                      <Badge tone="outline" size="sm">
                        {reminder.daysBefore}d before
                      </Badge>
                      <span className="text-ink-muted">
                        for the {formatDate(reminder.chargeDate)} charge
                      </span>
                      <span className="ml-auto text-xs text-ink-subtle">
                        {formatDateTime(reminder.sentAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Schedule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Next charge" value={isBilling ? formatDate(subscription.nextChargeAt) : '—'} />
              <Row label="Started" value={formatDate(subscription.startedAt)} />
              {subscription.trialEndsAt ? (
                <Row label="Trial ends" value={formatDate(subscription.trialEndsAt)} />
              ) : null}
              {subscription.endsAt ? (
                <Row label="Ends" value={formatDate(subscription.endsAt)} />
              ) : null}
              {subscription.noticeDays ? (
                <Row label="Notice period" value={`${subscription.noticeDays} days`} />
              ) : null}
              <Row
                label="Tax"
                value={subscription.taxInclusive ? 'Amount includes tax' : 'Tax added on top'}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Paid with</CardTitle>
            </CardHeader>
            <CardContent>
              {subscription.card ? (
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-surface-sunken text-ink-subtle">
                    <CreditCard className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {subscription.card.nickname}
                    </p>
                    <p className="font-mono text-xs text-ink-subtle">
                      ···· {subscription.card.last4}
                    </p>
                  </div>
                  <StatusBadge kind="card" value={subscription.card.status} size="sm" />
                </div>
              ) : (
                <p className="text-sm text-warning">
                  No card linked. Link one so this charge appears in the card footprint.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Platform</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-medium text-ink">{subscription.platform.name}</p>
              {subscription.platform.accountIdentifier ? (
                <p className="break-all text-xs text-ink-subtle">
                  {subscription.platform.accountIdentifier}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3 pt-1 text-xs">
                {subscription.platform.websiteUrl ? (
                  <a
                    href={
                      subscription.platform.websiteUrl.startsWith('http')
                        ? subscription.platform.websiteUrl
                        : `https://${subscription.platform.websiteUrl}`
                    }
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center gap-1 text-brand-500 hover:underline"
                  >
                    <ExternalLink className="size-3" aria-hidden /> Website
                  </a>
                ) : null}
                {subscription.platform.cancellationUrl ? (
                  <a
                    href={
                      subscription.platform.cancellationUrl.startsWith('http')
                        ? subscription.platform.cancellationUrl
                        : `https://${subscription.platform.cancellationUrl}`
                    }
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center gap-1 text-brand-500 hover:underline"
                  >
                    <ExternalLink className="size-3" aria-hidden /> Cancel here
                  </a>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {subscription.client || subscription.project || subscription.costCenter ? (
            <Card>
              <CardHeader>
                <CardTitle>Attribution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {subscription.client ? (
                  <div>
                    <p className="text-xs text-ink-subtle">Client</p>
                    <Link
                      href={`/clients/${subscription.client.id}`}
                      className="text-brand-500 hover:underline"
                    >
                      {subscription.client.name}
                    </Link>
                  </div>
                ) : null}
                {subscription.project ? (
                  <div>
                    <p className="text-xs text-ink-subtle">Project</p>
                    <Link
                      href={`/projects/${subscription.project.id}`}
                      className="text-brand-500 hover:underline"
                    >
                      {subscription.project.name}
                    </Link>
                  </div>
                ) : null}
                {subscription.costCenter ? (
                  <Row label="Cost centre" value={subscription.costCenter} />
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {subscription.notes ? (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-ink-muted">{subscription.notes}</p>
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-subtle">{label}</span>
      <span className="text-right text-ink">{value}</span>
    </div>
  );
}
