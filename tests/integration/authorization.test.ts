import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import type { Role } from '@/generated/prisma/enums';
import { resetTestData, setupTestDatabase, teardownTestDatabase } from '../helpers/db';

/**
 * Object-level authorization.
 *
 * Proves the scope predicates in `lib/auth/guard` actually exclude rows at
 * the database level — not merely in the UI. A Staff user must not be able
 * to read a project they are not attached to even when they know its id.
 */

let prisma: PrismaClient;

// The guard module imports the shared prisma singleton; point it at the test
// database before anything under test is loaded.
vi.mock('@/lib/db', async () => {
  const { getTestPrisma } = await import('../helpers/db');
  return {
    get prisma() {
      return getTestPrisma();
    },
  };
});

describe('object-level authorization', () => {
  let guard: typeof import('@/lib/auth/guard');
  let workspaceId: string;
  let otherWorkspaceId: string;
  const users: Record<string, string> = {};
  let insideProjectId: string;
  let outsideProjectId: string;
  let insideClientId: string;
  let outsideClientId: string;
  let invoiceId: string;

  function ctxFor(role: Role, userKey: string) {
    return {
      sessionId: 'session-test',
      workspaceId,
      role,
      mfaSatisfied: true,
      csrfToken: 'csrf',
      user: {
        id: users[userKey] as string,
        name: userKey,
        email: `${userKey}@example.com`,
        avatarColor: '#315CFD',
        themePref: 'system',
        timezone: null,
        mfaEnabled: false,
        emailOptOut: false,
      },
    };
  }

  beforeAll(async () => {
    prisma = await setupTestDatabase();
    guard = await import('@/lib/auth/guard');
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();

    const [ws, otherWs] = await Promise.all([
      prisma.workspace.create({ data: { name: 'Main', baseCurrency: 'PKR' } }),
      prisma.workspace.create({ data: { name: 'Other', baseCurrency: 'USD' } }),
    ]);
    workspaceId = ws.id;
    otherWorkspaceId = otherWs.id;

    for (const [key, role] of [
      ['admin', 'ADMIN'],
      ['manager', 'MANAGER'],
      ['staff', 'STAFF'],
      ['outsider', 'STAFF'],
    ] as const) {
      const user = await prisma.user.create({
        data: {
          name: key,
          email: `${key}@example.com`,
          memberships: { create: { workspaceId, role } },
        },
      });
      users[key] = user.id;
    }

    insideClientId = (
      await prisma.client.create({
        data: { workspaceId, name: 'Inside Co', normalizedName: 'insideco', billingCurrency: 'PKR' },
      })
    ).id;

    outsideClientId = (
      await prisma.client.create({
        data: { workspaceId, name: 'Outside Co', normalizedName: 'outsideco', billingCurrency: 'PKR' },
      })
    ).id;

    // A project the staff user belongs to.
    insideProjectId = (
      await prisma.project.create({
        data: {
          workspaceId,
          clientId: insideClientId,
          name: 'Inside project',
          currency: 'PKR',
          ownerId: users.manager as string,
          members: { create: [{ userId: users.staff as string }] },
        },
      })
    ).id;

    // A project the staff user has nothing to do with.
    outsideProjectId = (
      await prisma.project.create({
        data: {
          workspaceId,
          clientId: outsideClientId,
          name: 'Outside project',
          currency: 'PKR',
          ownerId: users.manager as string,
        },
      })
    ).id;

    invoiceId = (
      await prisma.invoice.create({
        data: {
          workspaceId,
          clientId: insideClientId,
          invoiceNumber: 'INV-0001',
          currency: 'PKR',
          issueDate: new Date('2026-01-01'),
          dueDate: new Date('2026-01-15'),
        },
      })
    ).id;
  });

  describe('projects', () => {
    it('lets an admin reach any project in the workspace', async () => {
      const ctx = ctxFor('ADMIN', 'admin');
      await expect(guard.assertProjectAccess(ctx, insideProjectId)).resolves.toBeUndefined();
      await expect(guard.assertProjectAccess(ctx, outsideProjectId)).resolves.toBeUndefined();
    });

    it('lets a staff member reach a project they are a member of', async () => {
      await expect(
        guard.assertProjectAccess(ctxFor('STAFF', 'staff'), insideProjectId),
      ).resolves.toBeUndefined();
    });

    it('denies a staff member a project they are not attached to', async () => {
      await expect(
        guard.assertProjectAccess(ctxFor('STAFF', 'staff'), outsideProjectId),
      ).rejects.toThrow(guard.NotFoundError);
    });

    it('reports an out-of-scope project as not found, not forbidden', async () => {
      // A "forbidden" response would confirm the id exists; "not found" does not.
      await expect(
        guard.assertProjectAccess(ctxFor('STAFF', 'staff'), outsideProjectId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('denies a project belonging to another workspace', async () => {
      const foreign = await prisma.project.create({
        data: { workspaceId: otherWorkspaceId, name: 'Foreign', currency: 'USD' },
      });
      await expect(
        guard.assertProjectAccess(ctxFor('ADMIN', 'admin'), foreign.id),
      ).rejects.toThrow(guard.NotFoundError);
    });
  });

  describe('clients', () => {
    it('lets a staff member reach a client via their project', async () => {
      await expect(
        guard.assertClientAccess(ctxFor('STAFF', 'staff'), insideClientId),
      ).resolves.toBeUndefined();
    });

    it('denies a client with no project the staff member belongs to', async () => {
      await expect(
        guard.assertClientAccess(ctxFor('STAFF', 'staff'), outsideClientId),
      ).rejects.toThrow(guard.NotFoundError);
    });

    it('lets a manager reach every client', async () => {
      const ctx = ctxFor('MANAGER', 'manager');
      await expect(guard.assertClientAccess(ctx, insideClientId)).resolves.toBeUndefined();
      await expect(guard.assertClientAccess(ctx, outsideClientId)).resolves.toBeUndefined();
    });
  });

  describe('tasks', () => {
    it('denies a task inside an out-of-scope project', async () => {
      const task = await prisma.task.create({
        data: { projectId: outsideProjectId, title: 'Secret task' },
      });
      await expect(guard.assertTaskAccess(ctxFor('STAFF', 'staff'), task.id)).rejects.toThrow(
        guard.NotFoundError,
      );
    });

    it('allows a task inside an in-scope project and returns its project', async () => {
      const task = await prisma.task.create({
        data: { projectId: insideProjectId, title: 'Visible task' },
      });
      await expect(guard.assertTaskAccess(ctxFor('STAFF', 'staff'), task.id)).resolves.toBe(
        insideProjectId,
      );
    });
  });

  describe('invoices', () => {
    it('refuses a role without invoice:read before touching the database', async () => {
      await expect(guard.assertInvoiceAccess(ctxFor('STAFF', 'staff'), invoiceId)).rejects.toThrow(
        guard.AuthorizationError,
      );
    });

    it('allows a finance user', async () => {
      await expect(
        guard.assertInvoiceAccess(ctxFor('FINANCE', 'admin'), invoiceId),
      ).resolves.toBeUndefined();
    });

    it('denies an invoice from another workspace even for an admin', async () => {
      const foreignClient = await prisma.client.create({
        data: {
          workspaceId: otherWorkspaceId,
          name: 'Foreign Co',
          normalizedName: 'foreignco',
          billingCurrency: 'USD',
        },
      });
      const foreignInvoice = await prisma.invoice.create({
        data: {
          workspaceId: otherWorkspaceId,
          clientId: foreignClient.id,
          invoiceNumber: 'INV-9999',
          currency: 'USD',
          issueDate: new Date('2026-01-01'),
          dueDate: new Date('2026-01-15'),
        },
      });
      await expect(
        guard.assertInvoiceAccess(ctxFor('ADMIN', 'admin'), foreignInvoice.id),
      ).rejects.toThrow(guard.NotFoundError);
    });
  });

  describe('scope predicates', () => {
    it('limits a staff list query to their own projects', async () => {
      const where = guard.projectScopeWhere(ctxFor('STAFF', 'staff'));
      const rows = await prisma.project.findMany({ where, select: { id: true } });
      expect(rows.map((r) => r.id)).toEqual([insideProjectId]);
    });

    it('returns the whole workspace for an admin', async () => {
      const where = guard.projectScopeWhere(ctxFor('ADMIN', 'admin'));
      const rows = await prisma.project.findMany({ where, select: { id: true } });
      expect(rows).toHaveLength(2);
    });

    it('never leaks another workspace into a scoped query', async () => {
      await prisma.project.create({
        data: { workspaceId: otherWorkspaceId, name: 'Foreign', currency: 'USD' },
      });
      const where = guard.projectScopeWhere(ctxFor('ADMIN', 'admin'));
      const rows = await prisma.project.findMany({ where, select: { workspaceId: true } });
      expect(rows.every((r) => r.workspaceId === workspaceId)).toBe(true);
    });

    it('limits a staff client query to clients reachable through a project', async () => {
      const where = guard.clientScopeWhere(ctxFor('STAFF', 'staff'));
      const rows = await prisma.client.findMany({ where, select: { id: true } });
      expect(rows.map((r) => r.id)).toEqual([insideClientId]);
    });
  });
});
