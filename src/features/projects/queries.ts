import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import type { AuthContext } from '@/lib/auth/session';
import { projectScopeWhere } from '@/lib/auth/guard';
import { escapeLike, type PaginatedResult, type Pagination, skipTake } from '@/lib/query';
import type { ProjectFilters, ProjectSortKey } from './schemas';

/** Project and task read models, always restricted to the actor's scope. */

export interface ProjectListRow {
  id: string;
  name: string;
  code: string | null;
  status: string;
  priority: string;
  currency: string;
  budgetAmount: string | null;
  startDate: Date | null;
  dueDate: Date | null;
  archivedAt: Date | null;
  client: { id: string; name: string } | null;
  owner: { id: string; name: string; avatarColor: string } | null;
  members: { name: string; avatarColor: string }[];
  taskCount: number;
  doneTaskCount: number;
}

function buildWhere(ctx: AuthContext, filters: ProjectFilters): Prisma.ProjectWhereInput {
  const where: Prisma.ProjectWhereInput = { ...projectScopeWhere(ctx) };
  const and: Prisma.ProjectWhereInput[] = [];

  if (!filters.includeArchived) and.push({ archivedAt: null });
  if (filters.search) {
    const term = escapeLike(filters.search);
    and.push({
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { code: { contains: term, mode: 'insensitive' } },
        { client: { name: { contains: term, mode: 'insensitive' } } },
      ],
    });
  }
  if (filters.status.length > 0) and.push({ status: { in: filters.status } });
  if (filters.priority.length > 0) and.push({ priority: { in: filters.priority } });
  if (filters.clientId) and.push({ clientId: filters.clientId });
  if (filters.ownerId) and.push({ ownerId: filters.ownerId });

  if (and.length > 0) where.AND = and;
  return where;
}

const SORT_FIELDS: Record<ProjectSortKey, keyof Prisma.ProjectOrderByWithRelationInput> = {
  name: 'name',
  dueDate: 'dueDate',
  status: 'status',
  priority: 'priority',
  createdAt: 'createdAt',
};

export async function listProjects(
  ctx: AuthContext,
  filters: ProjectFilters,
  pagination: Pagination,
  sort: { key: ProjectSortKey; direction: 'asc' | 'desc' },
): Promise<PaginatedResult<ProjectListRow>> {
  const where = buildWhere(ctx, filters);

  const [rows, total] = await Promise.all([
    prisma.project.findMany({
      where,
      // Nulls last for date sorts so undated projects do not crowd the top.
      orderBy: { [SORT_FIELDS[sort.key]]: { sort: sort.direction, nulls: 'last' } },
      ...skipTake(pagination),
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        priority: true,
        currency: true,
        budgetAmount: true,
        startDate: true,
        dueDate: true,
        archivedAt: true,
        client: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true, avatarColor: true } },
        members: { select: { user: { select: { name: true, avatarColor: true } } }, take: 6 },
        tasks: { select: { status: true } },
      },
    }),
    prisma.project.count({ where }),
  ]);

  return {
    rows: rows.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      status: p.status,
      priority: p.priority,
      currency: p.currency,
      budgetAmount: p.budgetAmount?.toString() ?? null,
      startDate: p.startDate,
      dueDate: p.dueDate,
      archivedAt: p.archivedAt,
      client: p.client,
      owner: p.owner,
      members: p.members.map((m) => m.user),
      taskCount: p.tasks.length,
      doneTaskCount: p.tasks.filter((t) => t.status === 'DONE').length,
    })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

export async function getProjectDetail(ctx: AuthContext, projectId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, ...projectScopeWhere(ctx) },
    include: {
      client: { select: { id: true, name: true, billingCurrency: true } },
      owner: { select: { id: true, name: true, avatarColor: true, email: true } },
      members: {
        select: {
          id: true,
          role: true,
          user: { select: { id: true, name: true, avatarColor: true, email: true } },
        },
      },
      tasks: {
        orderBy: [{ status: 'asc' }, { position: 'asc' }],
        include: {
          assignee: { select: { id: true, name: true, avatarColor: true } },
          _count: { select: { comments: true } },
        },
      },
      _count: { select: { invoices: true, files: true, expenses: true } },
    },
  });
}

export interface TaskCard {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | null;
  position: string;
  checklist: { id: string; label: string; done: boolean }[];
  assignee: { id: string; name: string; avatarColor: string } | null;
  commentCount: number;
}

export function toTaskCard(task: {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | null;
  position: Prisma.Decimal;
  checklist: Prisma.JsonValue;
  assignee: { id: string; name: string; avatarColor: string } | null;
  _count: { comments: number };
}): TaskCard {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    position: task.position.toString(),
    checklist: Array.isArray(task.checklist)
      ? (task.checklist as { id: string; label: string; done: boolean }[])
      : [],
    assignee: task.assignee,
    commentCount: task._count.comments,
  };
}

export async function getTaskDetail(ctx: AuthContext, taskId: string) {
  return prisma.task.findFirst({
    where: { id: taskId, project: projectScopeWhere(ctx) },
    include: {
      assignee: { select: { id: true, name: true, avatarColor: true } },
      project: { select: { id: true, name: true } },
      comments: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true, avatarColor: true } } },
      },
    },
  });
}

/** Workspace members, for owner and assignee pickers. */
export async function listWorkspaceMembers(ctx: AuthContext) {
  const memberships = await prisma.membership.findMany({
    where: { workspaceId: ctx.workspaceId, user: { status: 'ACTIVE' } },
    select: {
      role: true,
      user: { select: { id: true, name: true, email: true, avatarColor: true } },
    },
    orderBy: { user: { name: 'asc' } },
  });
  return memberships.map((m) => ({ ...m.user, role: m.role }));
}

export async function getProjectActivity(ctx: AuthContext, projectId: string, take = 30) {
  const taskIds = await prisma.task.findMany({ where: { projectId }, select: { id: true } });
  return prisma.auditLog.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      entityId: { in: [projectId, ...taskIds.map((t) => t.id)] },
    },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      summary: true,
      createdAt: true,
      actor: { select: { id: true, name: true, avatarColor: true } },
    },
  });
}

/** Tasks assigned to the current user across all visible projects. */
export async function listMyTasks(ctx: AuthContext, take = 10) {
  return prisma.task.findMany({
    where: {
      assigneeId: ctx.user.id,
      status: { notIn: ['DONE'] },
      project: projectScopeWhere(ctx),
    },
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }],
    take,
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      project: { select: { id: true, name: true } },
    },
  });
}
