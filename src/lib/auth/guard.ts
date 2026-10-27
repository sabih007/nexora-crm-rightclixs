import { redirect } from 'next/navigation';
import type { Role } from '@/generated/prisma/enums';
import { prisma } from '@/lib/db';
import {
  type Permission,
  roleHasPermission,
  roleIsScopedToAssignments,
  roleRequiresMfa,
} from '@/lib/permissions';
import { type AuthContext, getAuthContext } from './session';

/**
 * Authorization guards.
 *
 * Two layers, both mandatory for any mutation:
 *   1. capability — does this role hold the permission at all? (`requirePermission`)
 *   2. object scope — may this user touch *this* row? (`assertProjectAccess`, …)
 *
 * Both default to deny. Guards throw `AuthorizationError`, which the action
 * wrapper converts into a safe, non-leaking result for the client.
 */

export class AuthenticationError extends Error {
  readonly code = 'UNAUTHENTICATED';
  constructor(message = 'You must sign in to continue.') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(message = 'You do not have permission to perform this action.') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(message = 'Not found.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Authenticated context or throw. Use in server actions and route handlers.
 * For pages, prefer `requireAuthPage()` which redirects instead.
 */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new AuthenticationError();
  if (roleRequiresMfa(ctx.role) && ctx.user.mfaEnabled && !ctx.mfaSatisfied) {
    throw new AuthenticationError('Two-factor verification required.');
  }
  return ctx;
}

/** Page-level guard: redirects to login (or the MFA challenge) instead of throwing. */
export async function requireAuthPage(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');
  if (roleRequiresMfa(ctx.role) && ctx.user.mfaEnabled && !ctx.mfaSatisfied) {
    redirect('/login/verify');
  }
  return ctx;
}

export async function requirePermission(permission: Permission): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (!roleHasPermission(ctx.role, permission)) {
    throw new AuthorizationError();
  }
  return ctx;
}

export async function requireAnyPermission(
  permissions: readonly Permission[],
): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (!permissions.some((p) => roleHasPermission(ctx.role, p))) {
    throw new AuthorizationError();
  }
  return ctx;
}

/** Non-throwing capability check, for conditionally rendering UI. */
export function can(ctx: AuthContext | null, permission: Permission): boolean {
  if (!ctx) return false;
  return roleHasPermission(ctx.role, permission);
}

export function canRole(role: Role, permission: Permission): boolean {
  return roleHasPermission(role, permission);
}

// ---------------------------------------------------------------------------
// Object-level scope checks
// ---------------------------------------------------------------------------

/**
 * Prisma `where` fragment restricting projects to those the user may see.
 * Roles without `project:read_all` see only projects they own or are a member of.
 */
export function projectScopeWhere(ctx: AuthContext) {
  if (!roleIsScopedToAssignments(ctx.role)) {
    return { workspaceId: ctx.workspaceId };
  }
  return {
    workspaceId: ctx.workspaceId,
    OR: [{ ownerId: ctx.user.id }, { members: { some: { userId: ctx.user.id } } }],
  };
}

/**
 * Clients visible to the user. Scoped roles see only clients attached to a
 * project they belong to.
 */
export function clientScopeWhere(ctx: AuthContext) {
  if (!roleIsScopedToAssignments(ctx.role)) {
    return { workspaceId: ctx.workspaceId };
  }
  return {
    workspaceId: ctx.workspaceId,
    projects: {
      some: {
        OR: [{ ownerId: ctx.user.id }, { members: { some: { userId: ctx.user.id } } }],
      },
    },
  };
}

/**
 * Verify the actor may act on a specific project. Throws NotFoundError (not
 * Forbidden) when the row exists but is out of scope, so the response cannot
 * be used to probe for the existence of other workspaces' ids.
 */
export async function assertProjectAccess(ctx: AuthContext, projectId: string): Promise<void> {
  const found = await prisma.project.findFirst({
    where: { id: projectId, ...projectScopeWhere(ctx) },
    select: { id: true },
  });
  if (!found) throw new NotFoundError('Project not found.');
}

export async function assertClientAccess(ctx: AuthContext, clientId: string): Promise<void> {
  const found = await prisma.client.findFirst({
    where: { id: clientId, ...clientScopeWhere(ctx) },
    select: { id: true },
  });
  if (!found) throw new NotFoundError('Client not found.');
}

export async function assertTaskAccess(ctx: AuthContext, taskId: string): Promise<string> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, project: projectScopeWhere(ctx) },
    select: { id: true, projectId: true },
  });
  if (!task) throw new NotFoundError('Task not found.');
  return task.projectId;
}

/**
 * Files are visible when the user can see the owning client/project, or when
 * the file is unattached and the user has workspace-wide read.
 */
export async function assertFileAccess(ctx: AuthContext, fileId: string): Promise<void> {
  const scoped = roleIsScopedToAssignments(ctx.role);
  const file = await prisma.fileAsset.findFirst({
    where: {
      id: fileId,
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      ...(scoped
        ? {
            OR: [
              { uploadedById: ctx.user.id },
              { project: projectScopeWhere(ctx) },
              { client: clientScopeWhere(ctx) },
            ],
          }
        : {}),
    },
    select: { id: true },
  });
  if (!file) throw new NotFoundError('File not found.');
}

/** Invoices are workspace-scoped; scoped roles have no invoice read at all. */
export async function assertInvoiceAccess(ctx: AuthContext, invoiceId: string): Promise<void> {
  if (!roleHasPermission(ctx.role, 'invoice:read')) throw new AuthorizationError();
  const found = await prisma.invoice.findFirst({
    where: { id: invoiceId, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!found) throw new NotFoundError('Invoice not found.');
}
