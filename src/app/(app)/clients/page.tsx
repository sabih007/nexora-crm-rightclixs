import { Plus } from 'lucide-react';
import Link from 'next/link';
import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { first, parsePagination, parseSort, parseEnumList } from '@/lib/query';
import { CLIENT_SORT_KEYS, clientFilterSchema } from '@/features/clients/schemas';
import { listClientTags, listClients } from '@/features/clients/queries';
import { ClientsTable } from '@/features/clients/clients-table';

export const metadata = { title: 'Clients' };
export const dynamic = 'force-dynamic';

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'client:read')) {
    return (
      <>
        <PageHeader title="Clients" />
        <NoAccessState what="clients" />
      </>
    );
  }

  const params = await searchParams;

  const filters = clientFilterSchema.parse({
    search: first(params.search) ?? '',
    status: parseEnumList(params.status, ['ACTIVE', 'PROSPECT', 'INACTIVE', 'ARCHIVED']),
    type: parseEnumList(params.type, ['COMPANY', 'INDIVIDUAL']),
    currency: first(params.currency) ?? '',
    tag: first(params.tag) ?? '',
    includeArchived: first(params.includeArchived) === '1',
  });

  const pagination = parsePagination(params);
  const sort = parseSort(first(params.sort), CLIENT_SORT_KEYS, { key: 'name', direction: 'asc' });

  const [result, tags] = await Promise.all([
    listClients(ctx, filters, pagination, sort),
    listClientTags(ctx),
  ]);

  const canCreate = can(ctx, 'client:create');

  return (
    <>
      <PageHeader
        title="Clients"
        description="Companies and individuals this office works with."
        breadcrumbs={[{ label: 'Nexora OS', href: '/dashboard' }, { label: 'Clients' }]}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/clients/new">
                <Plus /> New client
              </Link>
            </Button>
          ) : null
        }
      />

      <ClientsTable
        data={result}
        filters={filters}
        sort={sort}
        tags={tags}
        canCreate={canCreate}
        canExport={can(ctx, 'client:export')}
        canImport={can(ctx, 'client:import')}
      />
    </>
  );
}
