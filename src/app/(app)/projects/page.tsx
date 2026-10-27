import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { first, parseEnumList, parsePagination, parseSort } from '@/lib/query';
import {
  PRIORITIES,
  PROJECT_SORT_KEYS,
  PROJECT_STATUSES,
  projectFilterSchema,
} from '@/features/projects/schemas';
import { listProjects, listWorkspaceMembers } from '@/features/projects/queries';
import { listClientOptions } from '@/features/clients/queries';
import { ProjectsTable } from '@/features/projects/projects-table';

export const metadata = { title: 'Projects' };
export const dynamic = 'force-dynamic';

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'project:read')) {
    return (
      <>
        <PageHeader title="Projects" />
        <NoAccessState what="projects" />
      </>
    );
  }

  const params = await searchParams;
  const filters = projectFilterSchema.parse({
    search: first(params.search) ?? '',
    status: parseEnumList(params.status, PROJECT_STATUSES),
    priority: parseEnumList(params.priority, PRIORITIES),
    clientId: first(params.clientId) ?? '',
    ownerId: first(params.ownerId) ?? '',
    includeArchived: first(params.includeArchived) === '1',
  });

  const pagination = parsePagination(params);
  const sort = parseSort(first(params.sort), PROJECT_SORT_KEYS, {
    key: 'dueDate',
    direction: 'asc',
  });

  const [result, clients, members] = await Promise.all([
    listProjects(ctx, filters, pagination, sort),
    listClientOptions(ctx),
    listWorkspaceMembers(ctx),
  ]);

  const canCreate = can(ctx, 'project:create');

  return (
    <>
      <PageHeader
        title="Projects"
        description="Delivery work, tasks and budgets."
        breadcrumbs={[{ label: 'Nexora OS', href: '/dashboard' }, { label: 'Projects' }]}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/projects/new">
                <Plus /> New project
              </Link>
            </Button>
          ) : null
        }
      />

      <ProjectsTable
        data={result}
        filters={filters}
        sort={sort}
        clients={clients}
        members={members.map((m) => ({ id: m.id, name: m.name }))}
        canCreate={canCreate}
      />
    </>
  );
}
