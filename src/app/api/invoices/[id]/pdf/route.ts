import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAuthContext } from '@/lib/auth/session';
import { roleHasPermission } from '@/lib/permissions';
import { recordAudit } from '@/lib/audit';
import { getObject } from '@/lib/storage';
import { renderInvoicePdf } from '@/features/invoices/pdf';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Invoice PDF download.
 *
 * Authorizes the session, then streams the stored snapshot. If no PDF has
 * been generated yet (a draft, or a failure after issuing) it renders one on
 * the fly rather than 404-ing, but it never stores a draft rendering as the
 * issued artifact.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleHasPermission(ctx.role, 'invoice:download_pdf')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    include: { lines: { orderBy: { position: 'asc' } }, client: true },
  });
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: Buffer;

  if (invoice.pdfFileId) {
    const file = await prisma.fileAsset.findFirst({
      where: { id: invoice.pdfFileId, workspaceId: ctx.workspaceId, deletedAt: null },
      select: { storageKey: true },
    });
    if (file) {
      body = await getObject(file.storageKey);
    } else {
      const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { id: ctx.workspaceId },
      });
      body = await renderInvoicePdf({ invoice, workspace });
    }
  } else {
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });
    body = await renderInvoicePdf({ invoice, workspace });
  }

  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorId: ctx.user.id,
    action: 'invoice.pdf_downloaded',
    entityType: 'Invoice',
    entityId: invoice.id,
    summary: invoice.invoiceNumber,
  }).catch((error) => logger.warn('Could not audit PDF download', { error }));

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(body.byteLength),
      'Content-Disposition': `inline; filename="${invoice.invoiceNumber}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
