import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAuthContext } from '@/lib/auth/session';
import { assertFileAccess } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { recordAudit } from '@/lib/audit';
import { getObjectStream, verifyDownloadToken } from '@/lib/storage';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Private file download.
 *
 * The storage key never leaves the server. Every request is authenticated,
 * checked against the role's `file:download` capability and then against
 * object-level scope, so knowing a file id is not enough to read it.
 *
 * An optional short-lived signed `token` lets a link survive a navigation
 * (opening a PDF in a new tab); it is an addition to the session check, not
 * a replacement — a leaked token alone cannot fetch the file.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!roleHasPermission(ctx.role, 'file:download')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const token = new URL(request.url).searchParams.get('token');
  if (token) {
    const payload = verifyDownloadToken(token);
    // A token minted for someone else must not work for this session.
    if (!payload || payload.fileId !== id || payload.userId !== ctx.user.id) {
      return NextResponse.json({ error: 'This download link is no longer valid.' }, { status: 403 });
    }
  }

  try {
    await assertFileAccess(ctx, id);
  } catch {
    // Deliberately 404, not 403: a "forbidden" would confirm the id exists.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const file = await prisma.fileAsset.findFirstOrThrow({
    where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
    select: {
      storageKey: true,
      originalName: true,
      mimeType: true,
      byteSize: true,
      scanStatus: true,
    },
  });

  if (file.scanStatus === 'INFECTED') {
    return NextResponse.json(
      { error: 'This file was flagged by a malware scan and cannot be downloaded.' },
      { status: 403 },
    );
  }

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await getObjectStream(file.storageKey);
  } catch (error) {
    logger.error('Could not read a stored object', { fileId: id, error });
    return NextResponse.json({ error: 'The stored file could not be read.' }, { status: 500 });
  }

  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorId: ctx.user.id,
    action: 'file.downloaded',
    entityType: 'FileAsset',
    entityId: id,
    summary: file.originalName,
  }).catch((error) => logger.warn('Could not audit a download', { error }));

  // Always as an attachment with a fixed type: serving user content inline
  // under our own origin is how a stored file becomes stored XSS.
  const asciiName = file.originalName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  const encodedName = encodeURIComponent(file.originalName);

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(file.byteSize),
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
}
