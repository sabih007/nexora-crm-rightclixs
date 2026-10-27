import { requireAuthPage } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { getWorkspace } from '@/lib/workspace';
import { NoAccessState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { ClientForm } from '@/features/clients/client-form';

export const metadata = { title: 'New client' };
export const dynamic = 'force-dynamic';

export default async function NewClientPage() {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'client:create')) {
    return (
      <>
        <PageHeader title="New client" />
        <NoAccessState what="client creation" />
      </>
    );
  }

  const workspace = await getWorkspace(ctx.workspaceId);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New client"
        description="Add a company or individual to the workspace."
        breadcrumbs={[
          { label: 'Nexora OS', href: '/dashboard' },
          { label: 'Clients', href: '/clients' },
          { label: 'New' },
        ]}
      />
      <ClientForm workspaceCurrency={workspace.baseCurrency} />
    </div>
  );
}
