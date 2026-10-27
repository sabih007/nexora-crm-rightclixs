import { requireAuthPage } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { getWorkspace } from '@/lib/workspace';
import { NoAccessState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { ProjectForm } from '@/features/projects/project-form';
import { listWorkspaceMembers } from '@/features/projects/queries';
import { listClientOptions } from '@/features/clients/queries';

export const metadata = { title: 'New project' };
export const dynamic = 'force-dynamic';

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'project:create')) {
    return (
      <>
        <PageHeader title="New project" />
        <NoAccessState what="project creation" />
      </>
    );
  }

  const params = await searchParams;
  const clientId = typeof params.clientId === 'string' ? params.clientId : null;

  const [clients, members, workspace] = await Promise.all([
    listClientOptions(ctx),
    listWorkspaceMembers(ctx),
    getWorkspace(ctx.workspaceId),
  ]);

  const preselected = clientId ? clients.find((c) => c.id === clientId) : undefined;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New project"
        description="Set up delivery work with a client, budget and team."
        breadcrumbs={[
          { label: 'Nexora OS', href: '/dashboard' },
          { label: 'Projects', href: '/projects' },
          { label: 'New' },
        ]}
      />
      <ProjectForm
        clients={clients}
        members={members}
        workspaceCurrency={preselected?.billingCurrency ?? workspace.baseCurrency}
        defaults={{
          clientId: preselected?.id ?? null,
          ownerId: ctx.user.id,
          memberIds: [ctx.user.id],
        }}
      />
    </div>
  );
}
