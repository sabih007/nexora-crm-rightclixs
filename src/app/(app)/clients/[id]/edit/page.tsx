import { notFound } from 'next/navigation';
import { requireAuthPage } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { getWorkspace } from '@/lib/workspace';
import { NoAccessState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { ClientForm } from '@/features/clients/client-form';
import { getClientDetail } from '@/features/clients/queries';
import type { ClientInput } from '@/features/clients/schemas';

export const metadata = { title: 'Edit client' };
export const dynamic = 'force-dynamic';

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAuthPage();

  if (!roleHasPermission(ctx.role, 'client:update')) {
    return (
      <>
        <PageHeader title="Edit client" />
        <NoAccessState what="client editing" />
      </>
    );
  }

  const [client, workspace] = await Promise.all([
    getClientDetail(ctx, id),
    getWorkspace(ctx.workspaceId),
  ]);
  if (!client) notFound();

  const address = (client.addressJson ?? {}) as Record<string, string | null>;

  const defaults: Partial<ClientInput> & { id: string } = {
    id: client.id,
    type: client.type,
    name: client.name,
    email: client.email,
    phone: client.phone,
    website: client.website,
    billingCurrency: client.billingCurrency,
    taxId: client.taxId,
    status: client.status === 'ARCHIVED' ? 'INACTIVE' : client.status,
    tags: client.tags,
    notes: client.notes,
    address: {
      line1: address.line1 ?? null,
      line2: address.line2 ?? null,
      city: address.city ?? null,
      state: address.state ?? null,
      postalCode: address.postalCode ?? null,
      country: address.country ?? null,
    },
    contacts: client.contacts.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      position: c.position,
      isPrimary: c.isPrimary,
    })),
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Edit ${client.name}`}
        breadcrumbs={[
          { label: 'Nexora OS', href: '/dashboard' },
          { label: 'Clients', href: '/clients' },
          { label: client.name, href: `/clients/${client.id}` },
          { label: 'Edit' },
        ]}
      />
      <ClientForm defaults={defaults} workspaceCurrency={workspace.baseCurrency} />
    </div>
  );
}
