import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import type { AuthContext } from '@/lib/auth/session';
import { clientScopeWhere, projectScopeWhere } from '@/lib/auth/guard';
import { roleIsScopedToAssignments } from '@/lib/permissions';
import { escapeLike, type PaginatedResult, type Pagination, skipTake } from '@/lib/query';

/** File and folder read models, scoped to what the actor may see. */

export interface FileListRow {
  id: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  category: string | null;
  tags: string[];
  version: number;
  scanStatus: string;
  isSystem: boolean;
  createdAt: Date;
  deletedAt: Date | null;
  uploadedBy: { id: string; name: string; avatarColor: string };
  client: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  folderIds: string[];
  /** True when a newer version of this file exists. */
  hasNewerVersion: boolean;
}

export interface FileFilters {
  search: string;
  clientId: string;
  projectId: string;
  folderId: string;
  category: string;
  includeDeleted: boolean;
  /** Only files that can be previewed as tabular data. */
  spreadsheetsOnly: boolean;
}

/**
 * Scope predicate for files: roles without workspace-wide project read see
 * only files they uploaded or that hang off a client/project they belong to.
 */
function fileScopeWhere(ctx: AuthContext): Prisma.FileAssetWhereInput {
  if (!roleIsScopedToAssignments(ctx.role)) {
    return { workspaceId: ctx.workspaceId };
  }
  return {
    workspaceId: ctx.workspaceId,
    OR: [
      { uploadedById: ctx.user.id },
      { project: projectScopeWhere(ctx) },
      { client: clientScopeWhere(ctx) },
    ],
  };
}

function buildWhere(ctx: AuthContext, filters: FileFilters): Prisma.FileAssetWhereInput {
  const where: Prisma.FileAssetWhereInput = fileScopeWhere(ctx);
  const and: Prisma.FileAssetWhereInput[] = [];

  if (!filters.includeDeleted) and.push({ deletedAt: null });
  if (filters.search) {
    const term = escapeLike(filters.search);
    and.push({ originalName: { contains: term, mode: 'insensitive' } });
  }
  if (filters.clientId) and.push({ clientId: filters.clientId });
  if (filters.projectId) and.push({ projectId: filters.projectId });
  if (filters.category) and.push({ category: filters.category });
  if (filters.folderId) and.push({ folders: { some: { folderId: filters.folderId } } });
  if (filters.spreadsheetsOnly) {
    and.push({
      OR: [
        { originalName: { endsWith: '.csv', mode: 'insensitive' } },
        { originalName: { endsWith: '.xlsx', mode: 'insensitive' } },
      ],
    });
  }

  if (and.length > 0) where.AND = and;
  return where;
}

export async function listFiles(
  ctx: AuthContext,
  filters: FileFilters,
  pagination: Pagination,
): Promise<PaginatedResult<FileListRow>> {
  const where = buildWhere(ctx, filters);

  const [rows, total] = await Promise.all([
    prisma.fileAsset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...skipTake(pagination),
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        byteSize: true,
        category: true,
        tags: true,
        version: true,
        scanStatus: true,
        isSystem: true,
        createdAt: true,
        deletedAt: true,
        rootFileId: true,
        uploadedBy: { select: { id: true, name: true, avatarColor: true } },
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        folders: { select: { folderId: true } },
        versions: { select: { id: true }, take: 1 },
      },
    }),
    prisma.fileAsset.count({ where }),
  ]);

  return {
    rows: rows.map((file) => ({
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      byteSize: file.byteSize,
      category: file.category,
      tags: file.tags,
      version: file.version,
      scanStatus: file.scanStatus,
      isSystem: file.isSystem,
      createdAt: file.createdAt,
      deletedAt: file.deletedAt,
      uploadedBy: file.uploadedBy,
      client: file.client,
      project: file.project,
      folderIds: file.folders.map((f) => f.folderId),
      hasNewerVersion: file.versions.length > 0,
    })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

export async function getFileDetail(ctx: AuthContext, fileId: string) {
  return prisma.fileAsset.findFirst({
    where: { id: fileId, ...fileScopeWhere(ctx) },
    include: {
      uploadedBy: { select: { id: true, name: true, avatarColor: true } },
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      folders: { include: { folder: { select: { id: true, name: true } } } },
      versions: {
        orderBy: { version: 'desc' },
        select: {
          id: true,
          version: true,
          originalName: true,
          byteSize: true,
          createdAt: true,
          uploadedBy: { select: { name: true } },
        },
      },
    },
  });
}

/** Folder tree for the sidebar. */
export async function listFolders(ctx: AuthContext) {
  const folders = await prisma.folder.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      parentId: true,
      clientId: true,
      projectId: true,
      client: { select: { name: true } },
      project: { select: { name: true } },
      _count: { select: { files: true } },
    },
  });

  return folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    clientId: folder.clientId,
    projectId: folder.projectId,
    contextLabel: folder.client?.name ?? folder.project?.name ?? null,
    fileCount: folder._count.files,
  }));
}

/** Distinct categories in use, for the filter dropdown. */
export async function listFileCategories(ctx: AuthContext): Promise<string[]> {
  const rows = await prisma.fileAsset.findMany({
    where: { ...fileScopeWhere(ctx), deletedAt: null, category: { not: null } },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });
  return rows.map((r) => r.category).filter((c): c is string => Boolean(c));
}

/** Storage used, for the Settings page. */
export async function getStorageUsage(ctx: AuthContext) {
  const [active, deleted] = await Promise.all([
    prisma.fileAsset.aggregate({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      _sum: { byteSize: true },
      _count: true,
    }),
    prisma.fileAsset.aggregate({
      where: { workspaceId: ctx.workspaceId, deletedAt: { not: null } },
      _sum: { byteSize: true },
      _count: true,
    }),
  ]);

  return {
    activeBytes: active._sum.byteSize ?? 0,
    activeCount: active._count,
    deletedBytes: deleted._sum.byteSize ?? 0,
    deletedCount: deleted._count,
  };
}

/** A file's bytes, for preview and import. Authorization is the caller's job. */
export async function getFileForProcessing(ctx: AuthContext, fileId: string) {
  return prisma.fileAsset.findFirst({
    where: { id: fileId, ...fileScopeWhere(ctx), deletedAt: null },
    select: {
      id: true,
      storageKey: true,
      originalName: true,
      mimeType: true,
      byteSize: true,
      scanStatus: true,
    },
  });
}
