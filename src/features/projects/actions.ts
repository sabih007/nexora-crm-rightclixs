'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { ActionError, defineAction } from '@/lib/action';
import { recordAudit } from '@/lib/audit';
import { assertClientAccess, assertProjectAccess, assertTaskAccess } from '@/lib/auth/guard';
import { fromDateInput } from '@/lib/dates';
import { Decimal } from '@/lib/money';
import {
  moveTaskSchema,
  projectIdSchema,
  projectInputSchema,
  taskCommentSchema,
  taskIdSchema,
  taskInputSchema,
  updateProjectSchema,
  updateTaskSchema,
} from './schemas';

/** Project and task mutations. */

function toDate(value: string | null | undefined): Date | null {
  return value ? fromDateInput(value) : null;
}

export const createProject = defineAction({
  name: 'project.create',
  permission: 'project:create',
  input: projectInputSchema,
  handler: async ({ input, ctx }) => {
    if (input.clientId) await assertClientAccess(ctx, input.clientId);

    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          workspaceId: ctx.workspaceId,
          clientId: input.clientId ?? null,
          name: input.name,
          code: input.code ?? null,
          description: input.description ?? null,
          ownerId: input.ownerId ?? ctx.user.id,
          status: input.status,
          priority: input.priority,
          budgetAmount: input.budgetAmount ?? null,
          currency: input.currency,
          startDate: toDate(input.startDate),
          dueDate: toDate(input.dueDate),
          tags: input.tags,
          members: {
            create: [...new Set([...input.memberIds, input.ownerId ?? ctx.user.id])].map(
              (userId) => ({ userId }),
            ),
          },
        },
        select: { id: true, name: true, status: true },
      });

      await recordAudit(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.user.id,
          action: 'project.created',
          entityType: 'Project',
          entityId: created.id,
          summary: created.name,
          after: created,
        },
        tx,
      );

      return created;
    });

    revalidatePath('/projects');
    return { id: project.id };
  },
});

export const updateProject = defineAction({
  name: 'project.update',
  permission: 'project:update',
  input: updateProjectSchema,
  handler: async ({ input, ctx }) => {
    await assertProjectAccess(ctx, input.id);
    const data = input.data;
    if (data.clientId) await assertClientAccess(ctx, data.clientId);

    const before = await prisma.project.findUniqueOrThrow({
      where: { id: input.id },
      select: {
        name: true,
        status: true,
        priority: true,
        budgetAmount: true,
        currency: true,
        dueDate: true,
        ownerId: true,
      },
    });

    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: input.id },
        data: {
          clientId: data.clientId ?? null,
          name: data.name,
          code: data.code ?? null,
          description: data.description ?? null,
          ownerId: data.ownerId ?? null,
          status: data.status,
          priority: data.priority,
          budgetAmount: data.budgetAmount ?? null,
          currency: data.currency,
          startDate: toDate(data.startDate),
          dueDate: toDate(data.dueDate),
          tags: data.tags,
          completedAt:
            data.status === 'COMPLETED'
              ? before.status === 'COMPLETED'
                ? undefined
                : new Date()
              : null,
        },
      });

      // Replace the member set, always keeping the owner in it.
      const desired = new Set(data.memberIds);
      if (data.ownerId) desired.add(data.ownerId);
      await tx.projectMember.deleteMany({
        where: { projectId: input.id, NOT: { userId: { in: [...desired] } } },
      });
      const existing = await tx.projectMember.findMany({
        where: { projectId: input.id },
        select: { userId: true },
      });
      const existingIds = new Set(existing.map((m) => m.userId));
      const toAdd = [...desired].filter((id) => !existingIds.has(id));
      if (toAdd.length > 0) {
        await tx.projectMember.createMany({
          data: toAdd.map((userId) => ({ projectId: input.id, userId })),
        });
      }

      await recordAudit(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.user.id,
          action: 'project.updated',
          entityType: 'Project',
          entityId: input.id,
          summary: data.name,
          before,
          after: {
            name: data.name,
            status: data.status,
            priority: data.priority,
            budgetAmount: data.budgetAmount,
            currency: data.currency,
            dueDate: data.dueDate,
            ownerId: data.ownerId,
          },
        },
        tx,
      );
    });

    revalidatePath('/projects');
    revalidatePath(`/projects/${input.id}`);
    return { id: input.id };
  },
});

export const deleteProject = defineAction({
  name: 'project.delete',
  permission: 'project:delete',
  input: projectIdSchema,
  handler: async ({ input, ctx }) => {
    await assertProjectAccess(ctx, input.id);

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: input.id },
      select: { name: true, _count: { select: { invoices: true, expenses: true } } },
    });

    if (project._count.invoices > 0 || project._count.expenses > 0) {
      throw new ActionError(
        `"${project.name}" is referenced by ${project._count.invoices} invoice(s) and ${project._count.expenses} expense(s). Mark it cancelled instead of deleting it.`,
        { code: 'HAS_FINANCIAL_LINKS' },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.project.delete({ where: { id: input.id } });
      await recordAudit(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.user.id,
          action: 'project.deleted',
          entityType: 'Project',
          entityId: input.id,
          summary: project.name,
        },
        tx,
      );
    });

    revalidatePath('/projects');
    return { id: input.id };
  },
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/**
 * Fractional ordering: a task dropped between two others takes the midpoint of
 * their positions, so a reorder writes one row instead of renumbering a column.
 */
const POSITION_GAP = 1000;

async function nextPosition(projectId: string, status: string): Promise<Decimal> {
  const last = await prisma.task.findFirst({
    where: { projectId, status: status as never },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  return last
    ? new Decimal(last.position.toString()).plus(POSITION_GAP)
    : new Decimal(POSITION_GAP);
}

export const createTask = defineAction({
  name: 'task.create',
  permission: 'task:create',
  input: taskInputSchema,
  handler: async ({ input, ctx }) => {
    await assertProjectAccess(ctx, input.projectId);

    const task = await prisma.task.create({
      data: {
        projectId: input.projectId,
        title: input.title,
        description: input.description ?? null,
        assigneeId: input.assigneeId ?? null,
        status: input.status,
        priority: input.priority,
        dueDate: toDate(input.dueDate),
        checklist: input.checklist,
        position: (await nextPosition(input.projectId, input.status)).toString(),
      },
      select: { id: true, title: true, status: true, assigneeId: true },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'task.created',
      entityType: 'Task',
      entityId: task.id,
      summary: task.title,
    });

    if (task.assigneeId && task.assigneeId !== ctx.user.id) {
      await prisma.notification.create({
        data: {
          workspaceId: ctx.workspaceId,
          userId: task.assigneeId,
          type: 'TASK_ASSIGNED',
          title: 'Task assigned to you',
          body: task.title,
          link: `/projects/${input.projectId}?task=${task.id}`,
        },
      });
    }

    revalidatePath(`/projects/${input.projectId}`);
    return { id: task.id };
  },
});

export const updateTask = defineAction({
  name: 'task.update',
  permission: 'task:update',
  input: updateTaskSchema,
  handler: async ({ input, ctx }) => {
    const projectId = await assertTaskAccess(ctx, input.id);

    const before = await prisma.task.findUniqueOrThrow({
      where: { id: input.id },
      select: { title: true, status: true, priority: true, assigneeId: true, dueDate: true },
    });

    const data = input.data;
    const updated = await prisma.task.update({
      where: { id: input.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description ?? null } : {}),
        ...(data.assigneeId !== undefined ? { assigneeId: data.assigneeId ?? null } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.dueDate !== undefined ? { dueDate: toDate(data.dueDate) } : {}),
        ...(data.checklist !== undefined ? { checklist: data.checklist } : {}),
        ...(data.status !== undefined
          ? { completedAt: data.status === 'DONE' ? new Date() : null }
          : {}),
      },
      select: { id: true, title: true, status: true, assigneeId: true },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'task.updated',
      entityType: 'Task',
      entityId: updated.id,
      summary: updated.title,
      before,
      after: { title: updated.title, status: updated.status, assigneeId: updated.assigneeId },
    });

    if (
      updated.assigneeId &&
      updated.assigneeId !== before.assigneeId &&
      updated.assigneeId !== ctx.user.id
    ) {
      await prisma.notification.create({
        data: {
          workspaceId: ctx.workspaceId,
          userId: updated.assigneeId,
          type: 'TASK_ASSIGNED',
          title: 'Task assigned to you',
          body: updated.title,
          link: `/projects/${projectId}?task=${updated.id}`,
        },
      });
    }

    revalidatePath(`/projects/${projectId}`);
    return { id: updated.id };
  },
});

/** Kanban drag-and-drop: change column and/or position. */
export const moveTask = defineAction({
  name: 'task.move',
  permission: 'task:update',
  input: moveTaskSchema,
  handler: async ({ input, ctx }) => {
    const projectId = await assertTaskAccess(ctx, input.id);

    const neighbours = await prisma.task.findMany({
      where: {
        id: { in: [input.beforeTaskId, input.afterTaskId].filter((v): v is string => Boolean(v)) },
      },
      select: { id: true, position: true },
    });

    const beforePos = neighbours.find((t) => t.id === input.beforeTaskId)?.position;
    const afterPos = neighbours.find((t) => t.id === input.afterTaskId)?.position;

    let position: Decimal;
    if (beforePos && afterPos) {
      position = new Decimal(beforePos.toString()).plus(afterPos.toString()).dividedBy(2);
    } else if (beforePos) {
      position = new Decimal(beforePos.toString()).plus(POSITION_GAP);
    } else if (afterPos) {
      position = new Decimal(afterPos.toString()).dividedBy(2);
    } else {
      position = await nextPosition(projectId, input.status);
    }

    await prisma.task.update({
      where: { id: input.id },
      data: {
        status: input.status,
        position: position.toDecimalPlaces(6).toString(),
        completedAt: input.status === 'DONE' ? new Date() : null,
      },
    });

    revalidatePath(`/projects/${projectId}`);
    return { id: input.id, status: input.status };
  },
});

export const deleteTask = defineAction({
  name: 'task.delete',
  permission: 'task:delete',
  input: taskIdSchema,
  handler: async ({ input, ctx }) => {
    const projectId = await assertTaskAccess(ctx, input.id);
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: input.id },
      select: { title: true },
    });

    await prisma.task.delete({ where: { id: input.id } });
    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'task.deleted',
      entityType: 'Task',
      entityId: input.id,
      summary: task.title,
    });

    revalidatePath(`/projects/${projectId}`);
    return { id: input.id };
  },
});

export const addTaskComment = defineAction({
  name: 'task.comment',
  permission: 'task:comment',
  input: taskCommentSchema,
  handler: async ({ input, ctx }) => {
    const projectId = await assertTaskAccess(ctx, input.taskId);

    const comment = await prisma.taskComment.create({
      data: { taskId: input.taskId, authorId: ctx.user.id, body: input.body },
      select: { id: true, createdAt: true },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'task.commented',
      entityType: 'Task',
      entityId: input.taskId,
    });

    revalidatePath(`/projects/${projectId}`);
    return { id: comment.id };
  },
});
