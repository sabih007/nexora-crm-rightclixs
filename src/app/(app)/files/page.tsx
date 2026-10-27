import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { first, parsePagination } from '@/lib/query';
import { env } from '@/lib/env';
import {
  listFileCategories,
  listFiles,
  listFolders,
  type FileFilters,
} from '@/features/files/queries';
import { listClientOptions } from '@/features/clients/queries';
import { FilesExplorer } from '@/features/files/files-explorer';

export const metadata = { title: 'Sheets & Files' };
export const dynamic = 'force-dynamic';

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'file:read')) {
    return (
      <>
        <PageHeader title="Sheets & Files" />
        <NoAccessState what="files" />
      </>
    );
  }

  const params = await searchParams;
  const filters: FileFilters = {
    search: first(params.search) ?? '',
    clientId: first(params.clientId) ?? '',
    projectId: first(params.projectId) ?? '',
    folderId: first(params.folderId) ?? '',
    category: first(params.category) ?? '',
    includeDeleted: first(params.includeDeleted) === '1',
    spreadsheetsOnly: first(params.spreadsheetsOnly) === '1',
  };

  const [result, folders, categories, clients] = await Promise.all([
    listFiles(ctx, filters, parsePagination(params)),
    listFolders(ctx),
    listFileCategories(ctx),
    listClientOptions(ctx),
  ]);

  return (
    <>
      <PageHeader
        title="Sheets & Files"
        description="Documents and spreadsheets, stored privately and downloadable only by people with access."
        breadcrumbs={[{ label: 'Nexora OS', href: '/dashboard' }, { label: 'Sheets & Files' }]}
      />

      <FilesExplorer
        data={result}
        filters={filters}
        folders={folders}
        categories={categories}
        clients={clients}
        maxUploadBytes={env.UPLOAD_MAX_BYTES}
        permissions={{
          upload: can(ctx, 'file:upload'),
          update: can(ctx, 'file:update'),
          delete: can(ctx, 'file:delete'),
          download: can(ctx, 'file:download'),
          importData: can(ctx, 'file:import_data'),
        }}
      />
    </>
  );
}
