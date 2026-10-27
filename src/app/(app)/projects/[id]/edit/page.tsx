import { notFound } from 'next/navigation';
import { requireAuthPage } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { getWorkspace } from '@/lib/workspace';
import { NoAccessState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { ProjectForm } from '@/features/projects/project-form';
import { getProjectDetail, listWorkspaceMembers } from '@/features/projects/queries';
import { listClientOptions } from '@/features/clients/queries';
import { toDateInput } from '@/lib/dates';

export const metadata = { title: 'Edit project' };
export const dynamic = 'force-dynamic';

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAuthPage();

  if (!roleHasPermission(ctx.role, 'project:update')) {
    return (
      <>
        <PageHeader title="Edit project" />
        <NoAccessState what="project editing" />
      </>
    );
  }

  const [project, clients, members, workspace] = await Promise.all([
    getProjectDetail(ctx, id),
    listClientOptions(ctx),
    listWorkspaceMembers(ctx),
    getWorkspace(ctx.workspaceId),
  ]);
  if (!project) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Edit ${project.name}`}
        breadcrumbs={[
          { label: 'Nexora OS', href: '/dashboard' },
          { label: 'Projects', href: '/projects' },
          { label: project.name, href: `/projects/${project.id}` },
          { label: 'Edit' },
        ]}
      />
      <ProjectForm
        projectId={project.id}
        clients={clients}
        members={members}
        workspaceCurrency={workspace.baseCurrency}
        defaults={{
          name: project.name,
          code: project.code,
          clientId: project.clientId,
          description: project.description,
          ownerId: project.ownerId,
          status: project.status,
          priority: project.priority,
          budgetAmount: project.budgetAmount?.toString() ?? null,
          currency: project.currency,
          startDate: toDateInput(project.startDate),
          dueDate: toDateInput(project.dueDate),
          tags: project.tags,
          memberIds: project.members.map((m) => m.user.id),
        }}
      />
    </div>
  );
}
