import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/session';
import { roleHasPermission } from '@/lib/permissions';
import { recordAudit } from '@/lib/audit';
import { toCsv } from '@/lib/file-safety';
import { RATE_LIMITS, rateLimit } from '@/lib/rate-limit';
import { listClients } from '@/features/clients/queries';
import { clientFilterSchema } from '@/features/clients/schemas';
import { first, parseEnumList } from '@/lib/query';
import { formatDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';

/**
 * Client CSV export.
 *
 * Every cell goes through `escapeCsvCell`, so a client name of
 * `=cmd|'/c calc'!A0` exports as inert text rather than a live formula.
 */
export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleHasPermission(ctx.role, 'client:export')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const limit = await rateLimit(ctx.user.id, RATE_LIMITS.export);
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Too many exports. Try again shortly.' }, { status: 429 });
  }

  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());

  const filters = clientFilterSchema.parse({
    search: first(params.search) ?? '',
    status: parseEnumList(params.status, ['ACTIVE', 'PROSPECT', 'INACTIVE', 'ARCHIVED']),
    type: parseEnumList(params.type, ['COMPANY', 'INDIVIDUAL']),
    currency: first(params.currency) ?? '',
    tag: first(params.tag) ?? '',
    includeArchived: first(params.includeArchived) === '1',
  });

  const canSeeSensitive = roleHasPermission(ctx.role, 'client:read_sensitive');

  // Export the whole filtered set, not just the current page.
  const result = await listClients(
    ctx,
    filters,
    { page: 1, pageSize: 100 },
    { key: 'name', direction: 'asc' },
  );
  const allRows = [...result.rows];
  const totalPages = Math.ceil(result.total / 100);
  for (let page = 2; page <= totalPages && page <= 100; page += 1) {
    const next = await listClients(
      ctx,
      filters,
      { page, pageSize: 100 },
      { key: 'name', direction: 'asc' },
    );
    allRows.push(...next.rows);
  }

  const headers = [
    'Name',
    'Type',
    'Status',
    'Currency',
    ...(canSeeSensitive ? ['Email', 'Phone'] : []),
    'Projects',
    'Open invoices',
    'Tags',
    'Added',
  ];

  const rows = allRows.map((client) => [
    client.name,
    client.type,
    client.status,
    client.billingCurrency,
    ...(canSeeSensitive ? [client.email ?? '', client.phone ?? ''] : []),
    client.projectCount,
    client.openInvoiceCount,
    client.tags.join('; '),
    formatDate(client.createdAt, 'yyyy-MM-dd'),
  ]);

  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorId: ctx.user.id,
    action: 'client.exported',
    entityType: 'Client',
    summary: `${rows.length} client(s) exported to CSV`,
  });

  const csv = toCsv(rows, headers);
  const filename = `nexora-clients-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
