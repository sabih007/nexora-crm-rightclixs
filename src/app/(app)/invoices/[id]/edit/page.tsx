import { notFound, redirect } from 'next/navigation';
import { requireAuthPage } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { getWorkspaceSettings } from '@/lib/workspace';
import { NoAccessState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { InvoiceForm } from '@/features/invoices/invoice-form';
import { getInvoiceDetail } from '@/features/invoices/queries';
import { listClientOptions } from '@/features/clients/queries';
import { prisma } from '@/lib/db';
import { projectScopeWhere } from '@/lib/auth/guard';
import { toDateInput } from '@/lib/dates';

export const metadata = { title: 'Edit invoice' };
export const dynamic = 'force-dynamic';

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAuthPage();

  if (!roleHasPermission(ctx.role, 'invoice:update')) {
    return (
      <>
        <PageHeader title="Edit invoice" />
        <NoAccessState what="invoice editing" />
      </>
    );
  }

  const invoice = await getInvoiceDetail(ctx, id);
  if (!invoice) notFound();

  // An issued invoice is immutable; send the user back rather than showing a
  // form whose save would be refused.
  if (invoice.status !== 'DRAFT') redirect(`/invoices/${id}`);

  const [clients, projects, settings] = await Promise.all([
    listClientOptions(ctx),
    prisma.project.findMany({
      where: { ...projectScopeWhere(ctx), archivedAt: null },
      select: { id: true, name: true, clientId: true },
      orderBy: { name: 'asc' },
      take: 500,
    }),
    getWorkspaceSettings(ctx.workspaceId),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Edit ${invoice.invoiceNumber}`}
        breadcrumbs={[
          { label: 'Nexora OS', href: '/dashboard' },
          { label: 'Invoices', href: '/invoices' },
          { label: invoice.invoiceNumber, href: `/invoices/${invoice.id}` },
          { label: 'Edit' },
        ]}
      />
      <InvoiceForm
        invoiceId={invoice.id}
        clients={clients}
        projects={projects}
        defaultTerms={settings.defaultInvoiceTerms}
        defaultPaymentTermDays={settings.defaultPaymentTermDays}
        defaults={{
          clientId: invoice.clientId,
          projectId: invoice.projectId,
          currency: invoice.currency,
          issueDate: toDateInput(invoice.issueDate),
          dueDate: toDateInput(invoice.dueDate),
          taxMode: invoice.taxMode,
          invoiceTaxRate: invoice.invoiceTaxRate.toString(),
          terms: invoice.terms,
          notes: invoice.notes,
          lines: invoice.lines.map((line) => ({
            id: line.id,
            description: line.description,
            quantity: line.quantity.toString(),
            unitPrice: line.unitPrice.toString(),
            discountAmount: line.discountAmount.toString(),
            taxRate: line.taxRate.toString(),
          })),
        }}
      />
    </div>
  );
}
