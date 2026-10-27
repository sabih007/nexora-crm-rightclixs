import { requireAuthPage } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState, Callout } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { ClientImportWizard } from '@/features/clients/import-wizard';
import { listFiles } from '@/features/files/queries';
import { first } from '@/lib/query';
import { env } from '@/lib/env';

export const metadata = { title: 'Import clients' };
export const dynamic = 'force-dynamic';

export default async function ImportClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'client:import')) {
    return (
      <>
        <PageHeader title="Import clients" />
        <NoAccessState what="client import" />
      </>
    );
  }

  const params = await searchParams;
  const fileId = first(params.fileId) ?? null;

  const spreadsheets = await listFiles(
    ctx,
    {
      search: '',
      clientId: '',
      projectId: '',
      folderId: '',
      category: '',
      includeDeleted: false,
      spreadsheetsOnly: true,
    },
    { page: 1, pageSize: 20 },
  );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Import clients"
        description="Bring clients in from a CSV or Excel file."
        breadcrumbs={[
          { label: 'Nexora OS', href: '/dashboard' },
          { label: 'Clients', href: '/clients' },
          { label: 'Import' },
        ]}
      />

      <Callout tone="info" className="mb-5">
        Nothing is written until the final step. You will see the column mapping and every row
        error before anything is created, and the uploaded file is kept unchanged.
      </Callout>

      <ClientImportWizard
        initialFileId={fileId}
        spreadsheets={spreadsheets.rows.map((f) => ({
          id: f.id,
          originalName: f.originalName,
          createdAt: f.createdAt,
        }))}
        maxUploadBytes={env.UPLOAD_MAX_BYTES}
      />
    </div>
  );
}
