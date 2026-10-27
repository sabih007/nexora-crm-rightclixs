import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Building2,
  Globe,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Receipt,
  User,
} from 'lucide-react';
import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { StatusBadge } from '@/components/shared/status-badge';
import { CurrencyAmount } from '@/components/shared/currency-amount';
import { ActivityTimeline } from '@/components/shared/activity-timeline';
import { EmptyState } from '@/components/ui/empty-state';
import {
  getClientActivity,
  getClientDetail,
  getClientFinancials,
} from '@/features/clients/queries';
import { ClientArchiveButton } from '@/features/clients/client-archive-button';
import { dec, sum } from '@/lib/money';
import { formatDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAuthPage();
  const client = await getClientDetail(ctx, id);
  return { title: client?.name ?? 'Client' };
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAuthPage();

  if (!roleHasPermission(ctx.role, 'client:read')) {
    return (
      <>
        <PageHeader title="Client" />
        <NoAccessState what="clients" />
      </>
    );
  }

  const client = await getClientDetail(ctx, id);
  if (!client) notFound();

  const [financials, activity] = await Promise.all([
    getClientFinancials(ctx, id),
    getClientActivity(ctx, id),
  ]);

  const address = (client.addressJson ?? {}) as Record<string, string>;
  const addressLines = [
    address.line1,
    address.line2,
    [address.city, address.state].filter(Boolean).join(', '),
    [address.postalCode, address.country].filter(Boolean).join(' '),
  ].filter((line): line is string => Boolean(line && line.trim()));

  // Receivable = issued, unpaid balance in the client's own currency. Invoices
  // in other currencies are listed separately rather than silently summed.
  const outstanding = financials
    ? sum(
        financials.invoices
          .filter(
            (inv) =>
              inv.currency === client.billingCurrency &&
              ['SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(inv.status),
          )
          .map((inv) => dec(inv.grandTotal.toString()).minus(dec(inv.amountPaid.toString()))),
      )
    : null;

  const lifetimeBilled = financials
    ? sum(
        financials.invoices
          .filter((inv) => inv.currency === client.billingCurrency && inv.status !== 'DRAFT')
          .map((inv) => inv.grandTotal.toString()),
      )
    : null;

  const mixedCurrencies = financials
    ? [...new Set(financials.invoices.map((i) => i.currency))].filter(
        (c) => c !== client.billingCurrency,
      )
    : [];

  return (
    <>
      <PageHeader
        title={client.name}
        breadcrumbs={[
          { label: 'Nexora OS', href: '/dashboard' },
          { label: 'Clients', href: '/clients' },
          { label: client.name },
        ]}
        badge={
          <>
            <StatusBadge kind="client" value={client.status} />
            <Badge tone="outline">
              {client.type === 'COMPANY' ? (
                <Building2 className="size-3" />
              ) : (
                <User className="size-3" />
              )}
              {client.type === 'COMPANY' ? 'Company' : 'Individual'}
            </Badge>
            <Badge tone="outline">{client.billingCurrency}</Badge>
          </>
        }
        actions={
          <>
            {can(ctx, 'client:update') ? (
              <Button variant="secondary" asChild>
                <Link href={`/clients/${client.id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
            ) : null}
            {can(ctx, 'invoice:create') ? (
              <Button asChild>
                <Link href={`/invoices/new?clientId=${client.id}`}>
                  <Receipt /> New invoice
                </Link>
              </Button>
            ) : null}
            {can(ctx, 'client:archive') ? (
              <ClientArchiveButton
                clientId={client.id}
                clientName={client.name}
                archived={Boolean(client.archivedAt)}
              />
            ) : null}
          </>
        }
      />

      {client.archivedAt ? (
        <div className="mb-4 rounded-lg border border-warning/25 bg-warning-soft px-3.5 py-2.5 text-sm text-ink-muted">
          This client was archived on {formatDate(client.archivedAt)}. Existing records are
          preserved and read-only in list views.
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="projects">Projects ({client.projects.length})</TabsTrigger>
              {financials ? (
                <TabsTrigger value="invoices">Invoices ({financials.invoices.length})</TabsTrigger>
              ) : null}
              {financials ? (
                <TabsTrigger value="payments">Payments ({financials.payments.length})</TabsTrigger>
              ) : null}
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Contacts</CardTitle>
                </CardHeader>
                <CardContent>
                  {!client.canSeeSensitive ? (
                    <p className="text-sm text-ink-subtle">
                      Contact details are restricted for your role.
                    </p>
                  ) : client.contacts.length === 0 ? (
                    <p className="text-sm text-ink-subtle">No contacts recorded.</p>
                  ) : (
                    <ul className="divide-y divide-[var(--line)]">
                      {client.contacts.map((contact) => (
                        <li key={contact.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                          <span className="text-sm font-medium text-ink">{contact.name}</span>
                          {contact.isPrimary ? (
                            <Badge tone="brand" size="sm">
                              Primary
                            </Badge>
                          ) : null}
                          {contact.position ? (
                            <span className="text-xs text-ink-subtle">{contact.position}</span>
                          ) : null}
                          <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-ink-muted">
                            {contact.email ? (
                              <a
                                href={`mailto:${contact.email}`}
                                className="inline-flex items-center gap-1 hover:text-brand-500"
                              >
                                <Mail className="size-3" aria-hidden /> {contact.email}
                              </a>
                            ) : null}
                            {contact.phone ? (
                              <a
                                href={`tel:${contact.phone}`}
                                className="inline-flex items-center gap-1 hover:text-brand-500"
                              >
                                <Phone className="size-3" aria-hidden /> {contact.phone}
                              </a>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {client.notes ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
                      {client.notes}
                    </p>
                  </CardContent>
                </Card>
              ) : null}
            </TabsContent>

            <TabsContent value="projects">
              {client.projects.length === 0 ? (
                <EmptyState
                  title="No projects"
                  description="Projects for this client will appear here."
                  action={
                    can(ctx, 'project:create') ? (
                      <Button asChild>
                        <Link href={`/projects/new?clientId=${client.id}`}>
                          <Plus /> New project
                        </Link>
                      </Button>
                    ) : null
                  }
                />
              ) : (
                <ul className="space-y-2">
                  {client.projects.map((project) => (
                    <li key={project.id}>
                      <Link
                        href={`/projects/${project.id}`}
                        className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:bg-surface-hover"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                          {project.name}
                        </span>
                        <StatusBadge kind="project" value={project.status} />
                        <StatusBadge kind="priority" value={project.priority} />
                        <span className="text-xs text-ink-subtle">{project._count.tasks} tasks</span>
                        {project.budgetAmount ? (
                          <CurrencyAmount
                            amount={project.budgetAmount.toString()}
                            currency={project.currency}
                            muted
                          />
                        ) : null}
                        {project.dueDate ? (
                          <span className="text-xs text-ink-subtle">
                            due {formatDate(project.dueDate)}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            {financials ? (
              <TabsContent value="invoices">
                {financials.invoices.length === 0 ? (
                  <EmptyState title="No invoices" description="Invoices raised for this client will appear here." />
                ) : (
                  <ul className="space-y-2">
                    {financials.invoices.map((invoice) => (
                      <li key={invoice.id}>
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:bg-surface-hover"
                        >
                          <span className="font-mono text-sm font-medium text-ink">
                            {invoice.invoiceNumber}
                          </span>
                          <StatusBadge kind="invoice" value={invoice.status} />
                          <span className="text-xs text-ink-subtle">
                            issued {formatDate(invoice.issueDate)} · due {formatDate(invoice.dueDate)}
                          </span>
                          <span className="ml-auto flex items-center gap-3">
                            <CurrencyAmount
                              amount={invoice.grandTotal.toString()}
                              currency={invoice.currency}
                              className="font-medium"
                            />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            ) : null}

            {financials ? (
              <TabsContent value="payments">
                {financials.payments.length === 0 ? (
                  <EmptyState title="No payments" description="Recorded payments will appear here." />
                ) : (
                  <ul className="space-y-2">
                    {financials.payments.map((payment) => (
                      <li
                        key={payment.id}
                        className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3"
                      >
                        <span className="text-sm text-ink">{formatDate(payment.paymentDate)}</span>
                        <Badge tone="outline">{payment.method.replace('_', ' ').toLowerCase()}</Badge>
                        {payment.reference ? (
                          <span className="truncate text-xs text-ink-subtle">
                            ref {payment.reference}
                          </span>
                        ) : null}
                        <CurrencyAmount
                          amount={payment.amount.toString()}
                          currency={payment.currency}
                          className="ml-auto font-medium"
                          tone="positive"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            ) : null}

            <TabsContent value="activity">
              <Card>
                <CardContent className="pt-5">
                  <ActivityTimeline entries={activity} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-4">
          {financials ? (
            <Card>
              <CardHeader>
                <CardTitle>Financial summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-ink-subtle">Outstanding balance</p>
                  <CurrencyAmount
                    amount={outstanding?.toString() ?? '0'}
                    currency={client.billingCurrency}
                    size="lg"
                    tone={outstanding && outstanding.greaterThan(0) ? 'negative' : 'neutral'}
                  />
                  <p className="mt-0.5 text-[11px] text-ink-subtle">
                    Issued invoices not yet fully paid.
                  </p>
                </div>
                <div className="border-t border-line pt-3">
                  <p className="text-xs text-ink-subtle">Lifetime invoiced</p>
                  <CurrencyAmount
                    amount={lifetimeBilled?.toString() ?? '0'}
                    currency={client.billingCurrency}
                  />
                  <p className="mt-0.5 text-[11px] text-ink-subtle">
                    Excludes drafts, voided and cancelled invoices.
                  </p>
                </div>
                {mixedCurrencies.length > 0 ? (
                  <p className="border-t border-line pt-3 text-[11px] text-warning">
                    This client also has invoices in {mixedCurrencies.join(', ')}. Totals above
                    cover {client.billingCurrency} only — see Reports for a converted view.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              {client.email ? (
                <p className="flex items-start gap-2">
                  <Mail className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                  <a href={`mailto:${client.email}`} className="break-all hover:text-brand-500">
                    {client.email}
                  </a>
                </p>
              ) : null}
              {client.phone ? (
                <p className="flex items-start gap-2">
                  <Phone className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                  <a href={`tel:${client.phone}`} className="hover:text-brand-500">
                    {client.phone}
                  </a>
                </p>
              ) : null}
              {client.website ? (
                <p className="flex items-start gap-2">
                  <Globe className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                  <a
                    href={client.website.startsWith('http') ? client.website : `https://${client.website}`}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="break-all hover:text-brand-500"
                  >
                    {client.website}
                  </a>
                </p>
              ) : null}
              {addressLines.length > 0 ? (
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                  <span className="text-ink-muted">
                    {addressLines.map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                  </span>
                </p>
              ) : null}
              {client.taxId ? (
                <p className="border-t border-line pt-2.5 text-xs">
                  <span className="text-ink-subtle">Tax ID: </span>
                  <span className="font-mono text-ink">{client.taxId}</span>
                </p>
              ) : null}
              <p className="border-t border-line pt-2.5 text-xs text-ink-subtle">
                Added {formatDate(client.createdAt)}
              </p>
            </CardContent>
          </Card>

          {client.tags.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Tags</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {client.tags.map((tag) => (
                  <Badge key={tag} tone="outline">
                    {tag}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}
