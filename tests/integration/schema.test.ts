import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { resetTestData, setupTestDatabase, teardownTestDatabase } from '../helpers/db';

/**
 * Proves the migration applies to a real PostgreSQL engine and that the
 * database-level invariants actually reject bad data — not just the Zod layer.
 */
describe('database schema', () => {
  let prisma: PrismaClient;
  let workspaceId: string;

  beforeAll(async () => {
    prisma = await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();
    const ws = await prisma.workspace.create({
      data: { name: 'Test Workspace', baseCurrency: 'PKR', timezone: 'UTC' },
    });
    workspaceId = ws.id;
  });

  it('generates UUID primary keys', async () => {
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    expect(ws.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('stores money as exact NUMERIC, not float', async () => {
    const client = await prisma.client.create({
      data: { workspaceId, name: 'Acme', normalizedName: 'acme', billingCurrency: 'USD' },
    });
    const invoice = await prisma.invoice.create({
      data: {
        workspaceId,
        clientId: client.id,
        invoiceNumber: 'INV-0001',
        currency: 'USD',
        issueDate: new Date('2026-01-01'),
        dueDate: new Date('2026-01-15'),
        subtotal: '0.1',
        grandTotal: '0.3',
      },
    });
    const fetched = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(fetched.grandTotal.toString()).toBe('0.3');
    expect(fetched.subtotal.plus(fetched.subtotal).plus(fetched.subtotal).toString()).toBe('0.3');
  });

  it('rejects a card last4 that is not exactly four digits', async () => {
    await expect(
      prisma.paymentCard.create({
        data: { workspaceId, nickname: 'Bad', issuer: 'Bank', last4: '12a4' },
      }),
    ).rejects.toThrow();
  });

  it('rejects a negative payment amount at the database level', async () => {
    const client = await prisma.client.create({
      data: { workspaceId, name: 'Beta', normalizedName: 'beta', billingCurrency: 'USD' },
    });
    const user = await prisma.user.create({
      data: { name: 'Tester', email: 'tester@example.com' },
    });
    await expect(
      prisma.payment.create({
        data: {
          workspaceId,
          clientId: client.id,
          amount: '-5',
          currency: 'USD',
          paymentDate: new Date('2026-01-02'),
          createdById: user.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects an invoice whose due date precedes its issue date', async () => {
    const client = await prisma.client.create({
      data: { workspaceId, name: 'Gamma', normalizedName: 'gamma', billingCurrency: 'USD' },
    });
    await expect(
      prisma.invoice.create({
        data: {
          workspaceId,
          clientId: client.id,
          invoiceNumber: 'INV-0002',
          currency: 'USD',
          issueDate: new Date('2026-02-10'),
          dueDate: new Date('2026-02-01'),
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces unique invoice numbers per workspace', async () => {
    const client = await prisma.client.create({
      data: { workspaceId, name: 'Delta', normalizedName: 'delta', billingCurrency: 'USD' },
    });
    const base = {
      workspaceId,
      clientId: client.id,
      currency: 'USD',
      issueDate: new Date('2026-03-01'),
      dueDate: new Date('2026-03-15'),
    };
    await prisma.invoice.create({ data: { ...base, invoiceNumber: 'INV-0100' } });
    await expect(
      prisma.invoice.create({ data: { ...base, invoiceNumber: 'INV-0100' } }),
    ).rejects.toThrow();
  });

  it('requires an interval for a custom-cadence subscription', async () => {
    const platform = await prisma.platform.create({
      data: { workspaceId, name: 'SomeService' },
    });
    await expect(
      prisma.subscription.create({
        data: {
          workspaceId,
          platformId: platform.id,
          planName: 'Custom',
          amount: '10',
          currency: 'USD',
          cadence: 'CUSTOM_DAYS',
          nextChargeAt: new Date('2026-04-01'),
          startedAt: new Date('2026-01-01'),
        },
      }),
    ).rejects.toThrow();
  });
});
