import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { first, parseEnumList, parsePagination, parseSort } from '@/lib/query';
import {
  INVOICE_SORT_KEYS,
  INVOICE_STATUSES,
  invoiceFilterSchema,
} from '@/features/invoices/schemas';
import { listInvoices } from '@/features/invoices/queries';
import { listClientOptions } from '@/features/clients/queries';
import { InvoicesTable } from '@/features/invoices/invoices-table';

export const metadata = { title: 'Invoices' };
export const dynamic = 'force-dynamic';

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'invoice:read')) {
    return (
      <>
        <PageHeader title="Invoices" />
        <NoAccessState what="invoices" />
      </>
    );
  }

  const params = await searchParams;
  const filters = invoiceFilterSchema.parse({
    search: first(params.search) ?? '',
    status: parseEnumList(params.status, INVOICE_STATUSES),
    clientId: first(params.clientId) ?? '',
    currency: first(params.currency) ?? '',
    from: first(params.from) ?? '',
    to: first(params.to) ?? '',
    unpaidOnly: first(params.unpaidOnly) === '1',
  });

  const pagination = parsePagination(params);
  const sort = parseSort(first(params.sort), INVOICE_SORT_KEYS, {
    key: 'issueDate',
    direction: 'desc',
  });

  const [result, clients] = await Promise.all([
    listInvoices(ctx, filters, pagination, sort),
    listClientOptions(ctx),
  ]);

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Issued and draft invoices, with payments and balances."
        breadcrumbs={[{ label: 'Nexora OS', href: '/dashboard' }, { label: 'Invoices' }]}
        actions={
          can(ctx, 'invoice:create') ? (
            <Button asChild>
              <Link href="/invoices/new">
                <Plus /> New invoice
              </Link>
            </Button>
          ) : null
        }
      />

      <InvoicesTable
        data={result}
        filters={filters}
        sort={sort}
        clients={clients}
        canCreate={can(ctx, 'invoice:create')}
        canExport={can(ctx, 'report:export')}
      />
    </>
  );
}
