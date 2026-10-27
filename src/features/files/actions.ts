'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ActionError, defineAction } from '@/lib/action';
import { recordAudit } from '@/lib/audit';
import { assertClientAccess, assertFileAccess, assertProjectAccess } from '@/lib/auth/guard';
import { deleteObject, putObject } from '@/lib/storage';
import { sanitizeFileName, validateUpload } from '@/lib/file-safety';
import { RATE_LIMITS, rateLimit } from '@/lib/rate-limit';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * File uploads, folders and versioning.
 *
 * Uploads arrive as multipart form data posted straight to this server
 * action, so the bytes are validated *before* they reach storage. A signed
 * browser-to-S3 upload would be faster for very large files but would let an
 * unvalidated object land in the bucket first; for office documents under
 * 25 MB the server round trip is the safer trade and is documented as such.
 */

const MAX_FILES_PER_REQUEST = 10;

export interface UploadedFileResult {
  id: string;
  originalName: string;
  byteSize: number;
  version: number;
}

export interface UploadOutcome {
  uploaded: UploadedFileResult[];
  rejected: { name: string; reason: string }[];
}

/**
 * Accept one or more files.
 * Rejections are reported per file rather than failing the whole batch, so
 * one bad document does not discard nine good ones.
 */
export async function uploadFiles(
  formData: FormData,
): Promise<{ ok: true; data: UploadOutcome } | { ok: false; error: string; code: string }> {
  const { requirePermission } = await import('@/lib/auth/guard');

  let ctx;
  try {
    ctx = await requirePermission('file:upload');
  } catch {
    return { ok: false, error: 'You do not have permission to upload files.', code: 'FORBIDDEN' };
  }

  const limit = await rateLimit(ctx.user.id, RATE_LIMITS.upload);
  if (!limit.allowed) {
    return { ok: false, error: 'Too many uploads. Try again shortly.', code: 'RATE_LIMITED' };
  }

  const clientId = asOptionalId(formData.get('clientId'));
  const projectId = asOptionalId(formData.get('projectId'));
  const folderId = asOptionalId(formData.get('folderId'));
  const category = asOptionalString(formData.get('category'));
  const replacesFileId = asOptionalId(formData.get('replacesFileId'));

  try {
    if (clientId) await assertClientAccess(ctx, clientId);
    if (projectId) await assertProjectAccess(ctx, projectId);
  } catch {
    return { ok: false, error: 'You cannot upload to that client or project.', code: 'FORBIDDEN' };
  }

  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return { ok: false, error: 'No file was supplied.', code: 'NO_FILE' };
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    return {
      ok: false,
      error: `Upload at most ${MAX_FILES_PER_REQUEST} files at a time.`,
      code: 'TOO_MANY',
    };
  }

  const outcome: UploadOutcome = { uploaded: [], rejected: [] };

  for (const file of files) {
    const displayName = sanitizeFileName(file.name);

    if (file.size > env.UPLOAD_MAX_BYTES) {
      outcome.rejected.push({
        name: displayName,
        reason: `Exceeds the ${Math.floor(env.UPLOAD_MAX_BYTES / 1_048_576)} MB limit.`,
      });
      continue;
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const verdict = validateUpload({
      originalName: file.name,
      declaredMimeType: file.type,
      size: buffer.byteLength,
      head: buffer.subarray(0, 512),
    });

    if (!verdict.ok) {
      outcome.rejected.push({ name: displayName, reason: verdict.reason });
      logger.warn('Rejected an upload', { name: displayName, reason: verdict.reason });
      continue;
    }

    try {
      const stored = await putObject(ctx.workspaceId, file.name, buffer);

      // Versioning: a replacement points back at the original's root.
      let version = 1;
      let rootFileId: string | null = null;
      if (replacesFileId) {
        const previous = await prisma.fileAsset.findFirst({
          where: { id: replacesFileId, workspaceId: ctx.workspaceId },
          select: { id: true, version: true, rootFileId: true },
        });
        if (previous) {
          rootFileId = previous.rootFileId ?? previous.id;
          const latest = await prisma.fileAsset.aggregate({
            where: { OR: [{ id: rootFileId }, { rootFileId }] },
            _max: { version: true },
          });
          version = (latest._max.version ?? previous.version) + 1;
        }
      }

      const created = await prisma.fileAsset.create({
        data: {
          workspaceId: ctx.workspaceId,
          clientId,
          projectId,
          uploadedById: ctx.user.id,
          storageKey: stored.storageKey,
          originalName: displayName,
          mimeType: file.type || 'application/octet-stream',
          byteSize: stored.byteSize,
          checksum: stored.checksum,
          // No malware scanner is wired up; say so rather than claiming clean.
          scanStatus: 'SKIPPED',
          scanNote: 'No malware scanner configured. Type, extension and signature were verified.',
          version,
          rootFileId,
          category: category ?? verdict.type.label,
          ...(folderId ? { folders: { create: { folderId } } } : {}),
        },
        select: { id: true, originalName: true, byteSize: true, version: true },
      });

      await recordAudit({
        workspaceId: ctx.workspaceId,
        actorId: ctx.user.id,
        action: 'file.uploaded',
        entityType: 'FileAsset',
        entityId: created.id,
        summary: `${created.originalName} (${verdict.type.label}, v${created.version})`,
      });

      outcome.uploaded.push(created);
    } catch (error) {
      logger.error('Upload failed while storing', { name: displayName, error });
      outcome.rejected.push({ name: displayName, reason: 'The file could not be stored.' });
    }
  }

  revalidatePath('/files');
  if (clientId) revalidatePath(`/clients/${clientId}`);
  if (projectId) revalidatePath(`/projects/${projectId}`);

  return { ok: true, data: outcome };
}

function asOptionalId(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return z.uuid().safeParse(value).success ? value : null;
}

function asOptionalString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value !== '' ? value.slice(0, 60) : null;
}

// ---------------------------------------------------------------------------
// File management
// ---------------------------------------------------------------------------

export const updateFile = defineAction({
  name: 'file.update',
  permission: 'file:update',
  input: z.object({
    id: z.uuid(),
    originalName: z.string().trim().min(1).max(200).optional(),
    category: z.string().trim().max(60).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    clientId: z.uuid().nullable().optional(),
    projectId: z.uuid().nullable().optional(),
  }),
  handler: async ({ input, ctx }) => {
    await assertFileAccess(ctx, input.id);
    if (input.clientId) await assertClientAccess(ctx, input.clientId);
    if (input.projectId) await assertProjectAccess(ctx, input.projectId);

    const before = await prisma.fileAsset.findUniqueOrThrow({
      where: { id: input.id },
      select: { originalName: true, category: true, tags: true },
    });

    await prisma.fileAsset.update({
      where: { id: input.id },
      data: {
        ...(input.originalName !== undefined
          ? { originalName: sanitizeFileName(input.originalName) }
          : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'file.updated',
      entityType: 'FileAsset',
      entityId: input.id,
      summary: input.originalName ?? before.originalName,
      before,
    });

    revalidatePath('/files');
    return { id: input.id };
  },
});

/**
 * Soft delete by default so an accidental removal is recoverable; a purge
 * also removes the stored object and is irreversible.
 */
export const deleteFile = defineAction({
  name: 'file.delete',
  permission: 'file:delete',
  input: z.object({ id: z.uuid(), purge: z.boolean().default(false) }),
  handler: async ({ input, ctx }) => {
    await assertFileAccess(ctx, input.id);

    const file = await prisma.fileAsset.findUniqueOrThrow({
      where: { id: input.id },
      select: { originalName: true, storageKey: true, isSystem: true },
    });

    if (file.isSystem) {
      throw new ActionError(
        'This file was generated by Nexora OS (an invoice PDF, for example) and is part of the financial record.',
        { code: 'SYSTEM_FILE' },
      );
    }

    if (input.purge) {
      await deleteObject(file.storageKey);
      await prisma.fileAsset.delete({ where: { id: input.id } });
    } else {
      await prisma.fileAsset.update({
        where: { id: input.id },
        data: { deletedAt: new Date() },
      });
    }

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'file.deleted',
      entityType: 'FileAsset',
      entityId: input.id,
      summary: `${file.originalName}${input.purge ? ' (permanently removed)' : ''}`,
    });

    revalidatePath('/files');
    return { id: input.id, purged: input.purge };
  },
});

export const restoreFile = defineAction({
  name: 'file.restore',
  permission: 'file:delete',
  input: z.object({ id: z.uuid() }),
  handler: async ({ input, ctx }) => {
    const file = await prisma.fileAsset.findFirst({
      where: { id: input.id, workspaceId: ctx.workspaceId },
      select: { originalName: true },
    });
    if (!file) throw new ActionError('File not found.', { code: 'NOT_FOUND' });

    await prisma.fileAsset.update({ where: { id: input.id }, data: { deletedAt: null } });
    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'file.updated',
      entityType: 'FileAsset',
      entityId: input.id,
      summary: `${file.originalName} restored`,
    });

    revalidatePath('/files');
    return { id: input.id };
  },
});

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export const createFolder = defineAction({
  name: 'folder.create',
  permission: 'file:upload',
  input: z.object({
    name: z.string().trim().min(1, 'Name the folder.').max(120),
    parentId: z.uuid().nullable().optional(),
    clientId: z.uuid().nullable().optional(),
    projectId: z.uuid().nullable().optional(),
  }),
  handler: async ({ input, ctx }) => {
    if (input.clientId) await assertClientAccess(ctx, input.clientId);
    if (input.projectId) await assertProjectAccess(ctx, input.projectId);

    const folder = await prisma.folder.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: input.name,
        parentId: input.parentId ?? null,
        clientId: input.clientId ?? null,
        projectId: input.projectId ?? null,
      },
      select: { id: true, name: true },
    });

    revalidatePath('/files');
    return folder;
  },
});

export const deleteFolder = defineAction({
  name: 'folder.delete',
  permission: 'file:delete',
  input: z.object({ id: z.uuid() }),
  handler: async ({ input, ctx }) => {
    const folder = await prisma.folder.findFirst({
      where: { id: input.id, workspaceId: ctx.workspaceId },
      select: { name: true, _count: { select: { files: true, children: true } } },
    });
    if (!folder) throw new ActionError('Folder not found.', { code: 'NOT_FOUND' });

    if (folder._count.files > 0 || folder._count.children > 0) {
      throw new ActionError(
        `"${folder.name}" still contains ${folder._count.files} file(s) and ${folder._count.children} subfolder(s). Empty it first — deleting a folder never deletes its files.`,
        { code: 'FOLDER_NOT_EMPTY' },
      );
    }

    await prisma.folder.delete({ where: { id: input.id } });
    revalidatePath('/files');
    return { id: input.id };
  },
});

export const moveFileToFolder = defineAction({
  name: 'file.move',
  permission: 'file:update',
  input: z.object({ fileId: z.uuid(), folderId: z.uuid().nullable() }),
  handler: async ({ input, ctx }) => {
    await assertFileAccess(ctx, input.fileId);

    await prisma.fileFolderLink.deleteMany({ where: { fileId: input.fileId } });
    if (input.folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: input.folderId, workspaceId: ctx.workspaceId },
        select: { id: true },
      });
      if (!folder) throw new ActionError('Folder not found.', { code: 'NOT_FOUND' });
      await prisma.fileFolderLink.create({
        data: { fileId: input.fileId, folderId: input.folderId },
      });
    }

    revalidatePath('/files');
    return { id: input.fileId };
  },
});
