import { requireAuthPage } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { getWorkspace, getWorkspaceSettings } from '@/lib/workspace';
import { NoAccessState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { InvoiceForm } from '@/features/invoices/invoice-form';
import { listClientOptions } from '@/features/clients/queries';
import { prisma } from '@/lib/db';
import { projectScopeWhere } from '@/lib/auth/guard';
import { first } from '@/lib/query';

export const metadata = { title: 'New invoice' };
export const dynamic = 'force-dynamic';

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'invoice:create')) {
    return (
      <>
        <PageHeader title="New invoice" />
        <NoAccessState what="invoice creation" />
      </>
    );
  }

  const params = await searchParams;
  const clientId = first(params.clientId);
  const projectId = first(params.projectId);

  const [clients, projects, workspace, settings] = await Promise.all([
    listClientOptions(ctx),
    prisma.project.findMany({
      where: { ...projectScopeWhere(ctx), archivedAt: null },
      select: { id: true, name: true, clientId: true },
      orderBy: { name: 'asc' },
      take: 500,
    }),
    getWorkspace(ctx.workspaceId),
    getWorkspaceSettings(ctx.workspaceId),
  ]);

  const preselected = clientId ? clients.find((c) => c.id === clientId) : undefined;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="New invoice"
        description="Build a draft. Nothing is issued or sent until you choose to."
        breadcrumbs={[
          { label: 'Nexora OS', href: '/dashboard' },
          { label: 'Invoices', href: '/invoices' },
          { label: 'New' },
        ]}
      />
      <InvoiceForm
        clients={clients}
        projects={projects}
        defaultTerms={settings.defaultInvoiceTerms}
        defaultPaymentTermDays={settings.defaultPaymentTermDays}
        defaults={{
          clientId: preselected?.id ?? '',
          projectId: projectId ?? null,
          currency: preselected?.billingCurrency ?? workspace.baseCurrency,
        }}
      />
    </div>
  );
}
