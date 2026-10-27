import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { resetTestData, setupTestDatabase, teardownTestDatabase } from '../helpers/db';
import {
  expectOk,
  makeContext,
  mockActionEnvironment,
  setActionContext,
} from '../helpers/action-context';

mockActionEnvironment();

/**
 * End-to-end invoice money flow through the real server actions:
 * draft → issue (immutable) → partial payment → full payment → credit note,
 * plus the authorization and idempotency guarantees around them.
 */

let prisma: PrismaClient;
let actions: typeof import('@/features/invoices/actions');

describe('invoice lifecycle', () => {
  let workspaceId: string;
  let financeUserId: string;
  let staffUserId: string;
  let clientId: string;

  beforeAll(async () => {
    prisma = await setupTestDatabase();
    actions = await import('@/features/invoices/actions');
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();

    const workspace = await prisma.workspace.create({
      data: { name: 'Test Office', baseCurrency: 'PKR', invoicePrefix: 'INV' },
    });
    workspaceId = workspace.id;

    const finance = await prisma.user.create({
      data: {
        name: 'Finance User',
        email: 'finance@example.com',
        memberships: { create: { workspaceId, role: 'FINANCE' } },
      },
    });
    financeUserId = finance.id;

    const staff = await prisma.user.create({
      data: {
        name: 'Staff User',
        email: 'staff@example.com',
        memberships: { create: { workspaceId, role: 'STAFF' } },
      },
    });
    staffUserId = staff.id;

    const client = await prisma.client.create({
      data: {
        workspaceId,
        name: 'Acme Ltd',
        normalizedName: 'acme',
        billingCurrency: 'USD',
        email: 'ap@acme.example.com',
      },
    });
    clientId = client.id;

    setActionContext(makeContext({ workspaceId, userId: financeUserId, role: 'FINANCE' }));
  });

  /**
   * Dates are relative to today so the status assertions stay correct as time
   * passes — a fixed 2026 date would silently become overdue and change what
   * `deriveInvoiceStatus` returns.
   */
  const dayOffset = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  const draftInput = () => ({
    clientId,
    projectId: null,
    currency: 'USD',
    issueDate: dayOffset(-1),
    dueDate: dayOffset(30),
    taxMode: 'PER_LINE' as const,
    invoiceTaxRate: '0',
    terms: 'Net 14',
    notes: null,
    lines: [
      {
        description: 'Consulting',
        quantity: '10',
        unitPrice: '100',
        discountAmount: '0',
        taxRate: '10',
      },
    ],
  });

  describe('creation', () => {
    it('computes totals server-side and stores them exactly', async () => {
      const created = expectOk(await actions.createInvoice(draftInput()));

      const invoice = await prisma.invoice.findUniqueOrThrow({
        where: { id: created.id },
        include: { lines: true },
      });

      expect(invoice.status).toBe('DRAFT');
      expect(invoice.subtotal.toString()).toBe('1000');
      expect(invoice.taxTotal.toString()).toBe('100');
      expect(invoice.grandTotal.toString()).toBe('1100');
      expect(invoice.lines).toHaveLength(1);
      expect(invoice.lines[0]?.lineTotal.toString()).toBe('1100');
    });

    it('allocates sequential invoice numbers', async () => {
      const a = expectOk(await actions.createInvoice(draftInput()));
      const b = expectOk(await actions.createInvoice(draftInput()));
      const year = new Date(dayOffset(-1)).getUTCFullYear();
      expect(a.invoiceNumber).toBe(`INV-${year}-0001`);
      expect(b.invoiceNumber).toBe(`INV-${year}-0002`);
    });

    it('refuses a role without invoice:create', async () => {
      setActionContext(makeContext({ workspaceId, userId: staffUserId, role: 'STAFF' }));
      const result = await actions.createInvoice(draftInput());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('FORBIDDEN');
    });

    it('rejects a due date before the issue date', async () => {
      const result = await actions.createInvoice({
        ...draftInput(),
        issueDate: dayOffset(30),
        dueDate: dayOffset(1),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION');
    });

    it('rejects an invoice with no line items', async () => {
      const result = await actions.createInvoice({ ...draftInput(), lines: [] });
      expect(result.ok).toBe(false);
    });
  });

  describe('issuing', () => {
    it('freezes the amounts and captures a client snapshot', async () => {
      const created = expectOk(await actions.createInvoice(draftInput()));
      expectOk(await actions.issueInvoice({ id: created.id, generatePdf: false }));

      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: created.id } });
      expect(invoice.status).toBe('SENT');
      expect(invoice.issuedAt).not.toBeNull();

      const snapshot = invoice.issuedSnapshotJson as { grandTotal: string; lines: unknown[] };
      expect(snapshot.grandTotal).toBe('1100');
      expect(snapshot.lines).toHaveLength(1);

      const clientSnapshot = invoice.clientSnapshotJson as { name: string };
      expect(clientSnapshot.name).toBe('Acme Ltd');
    });

    it('keeps the snapshot even if the client is later renamed', async () => {
      const created = expectOk(await actions.createInvoice(draftInput()));
      expectOk(await actions.issueInvoice({ id: created.id, generatePdf: false }));

      await prisma.client.update({
        where: { id: clientId },
        data: { name: 'Acme Holdings PLC' },
      });

      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: created.id } });
      expect((invoice.clientSnapshotJson as { name: string }).name).toBe('Acme Ltd');
    });

    it('refuses to edit an issued invoice', async () => {
      const created = expectOk(await actions.createInvoice(draftInput()));
      expectOk(await actions.issueInvoice({ id: created.id, generatePdf: false }));

      const result = await actions.updateInvoice({
        id: created.id,
        data: {
          ...draftInput(),
          lines: [
            {
              description: 'Changed',
              quantity: '1',
              unitPrice: '999999',
              discountAmount: '0',
              taxRate: '0',
            },
          ],
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('INVOICE_ISSUED');

      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: created.id } });
      expect(invoice.grandTotal.toString()).toBe('1100');
    });

    it('refuses to delete an issued invoice', async () => {
      const created = expectOk(await actions.createInvoice(draftInput()));
      expectOk(await actions.issueInvoice({ id: created.id, generatePdf: false }));

      const result = await actions.deleteDraftInvoice({ id: created.id });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('INVOICE_ISSUED');
      expect(await prisma.invoice.count({ where: { id: created.id } })).toBe(1);
    });

    it('allows deleting a draft', async () => {
      const created = expectOk(await actions.createInvoice(draftInput()));
      expectOk(await actions.deleteDraftInvoice({ id: created.id }));
      expect(await prisma.invoice.count({ where: { id: created.id } })).toBe(0);
    });

    it('cannot be issued twice', async () => {
      const created = expectOk(await actions.createInvoice(draftInput()));
      expectOk(await actions.issueInvoice({ id: created.id, generatePdf: false }));
      const second = await actions.issueInvoice({ id: created.id, generatePdf: false });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.code).toBe('ALREADY_ISSUED');
    });

    it('records an audit entry on issue', async () => {
      const created = expectOk(await actions.createInvoice(draftInput()));
      expectOk(await actions.issueInvoice({ id: created.id, generatePdf: false }));

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: created.id, action: 'invoice.issued' },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(financeUserId);
    });
  });

  describe('payments', () => {
    async function issuedInvoice() {
      const created = expectOk(await actions.createInvoice(draftInput()));
      expectOk(await actions.issueInvoice({ id: created.id, generatePdf: false }));
      return created;
    }

    it('applies a partial payment and moves the status', async () => {
      const invoice = await issuedInvoice();

      expectOk(
        await actions.recordPayment({
          clientId,
          invoiceId: invoice.id,
          amount: '400',
          currency: 'USD',
          paymentDate: dayOffset(0),
          method: 'BANK_TRANSFER',
          reference: 'TRX-1',
          notes: null,
          allocations: [],
          idempotencyKey: 'key-partial-1',
        }),
      );

      const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(updated.amountPaid.toString()).toBe('400');
      expect(updated.status).toBe('PARTIALLY_PAID');
    });

    it('marks the invoice paid when the balance reaches zero', async () => {
      const invoice = await issuedInvoice();

      expectOk(
        await actions.recordPayment({
          clientId,
          invoiceId: invoice.id,
          amount: '1100',
          currency: 'USD',
          paymentDate: dayOffset(0),
          method: 'BANK_TRANSFER',
          reference: null,
          notes: null,
          allocations: [],
          idempotencyKey: 'key-full-1',
        }),
      );

      const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(updated.amountPaid.toString()).toBe('1100');
      expect(updated.status).toBe('PAID');
      expect(updated.paidAt).not.toBeNull();
    });

    it('never records the same payment twice for one idempotency key', async () => {
      const invoice = await issuedInvoice();

      const payload = {
        clientId,
        invoiceId: invoice.id,
        amount: '500',
        currency: 'USD',
        paymentDate: dayOffset(0),
        method: 'BANK_TRANSFER' as const,
        reference: null,
        notes: null,
        allocations: [],
        idempotencyKey: 'duplicate-key',
      };

      const first = expectOk(await actions.recordPayment(payload));
      const second = expectOk(await actions.recordPayment(payload));

      expect(second.id).toBe(first.id);
      expect(second.duplicate).toBe(true);

      expect(await prisma.payment.count({ where: { clientId } })).toBe(1);
      const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(updated.amountPaid.toString()).toBe('500');
    });

    it('survives concurrent submissions of the same payment', async () => {
      const invoice = await issuedInvoice();

      const payload = {
        clientId,
        invoiceId: invoice.id,
        amount: '250',
        currency: 'USD',
        paymentDate: dayOffset(0),
        method: 'CARD' as const,
        reference: null,
        notes: null,
        allocations: [],
        idempotencyKey: 'concurrent-key',
      };

      const results = await Promise.all([
        actions.recordPayment(payload),
        actions.recordPayment(payload),
      ]);

      // One succeeds; the other either returns the same id or fails on the
      // unique index — in neither case is a second payment created.
      const succeeded = results.filter((r) => r.ok);
      expect(succeeded.length).toBeGreaterThanOrEqual(1);
      expect(await prisma.payment.count({ where: { clientId } })).toBe(1);

      const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(updated.amountPaid.toString()).toBe('250');
    });

    it('holds an overpayment as an unallocated credit rather than overfilling', async () => {
      const invoice = await issuedInvoice();

      const result = expectOk(
        await actions.recordPayment({
          clientId,
          invoiceId: invoice.id,
          amount: '1500',
          currency: 'USD',
          paymentDate: dayOffset(0),
          method: 'BANK_TRANSFER',
          reference: null,
          notes: null,
          allocations: [],
          idempotencyKey: 'key-over-1',
        }),
      );

      expect(result.unallocated).toBe('400');
      const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(updated.amountPaid.toString()).toBe('1100');
      expect(updated.status).toBe('PAID');
    });

    it('spreads a payment across several invoices oldest first', async () => {
      const first = await issuedInvoice();
      const second = expectOk(
        await actions.createInvoice({
          ...draftInput(),
          issueDate: dayOffset(0),
          dueDate: dayOffset(45),
        }),
      );
      expectOk(await actions.issueInvoice({ id: second.id, generatePdf: false }));

      expectOk(
        await actions.recordPayment({
          clientId,
          invoiceId: null,
          amount: '1500',
          currency: 'USD',
          paymentDate: dayOffset(0),
          method: 'BANK_TRANSFER',
          reference: null,
          notes: null,
          allocations: [],
          idempotencyKey: 'key-spread-1',
        }),
      );

      const a = await prisma.invoice.findUniqueOrThrow({ where: { id: first.id } });
      const b = await prisma.invoice.findUniqueOrThrow({ where: { id: second.id } });
      expect(a.amountPaid.toString()).toBe('1100');
      expect(a.status).toBe('PAID');
      expect(b.amountPaid.toString()).toBe('400');
      expect(b.status).toBe('PARTIALLY_PAID');
    });

    it('never applies a payment to an invoice in a different currency', async () => {
      const usdInvoice = await issuedInvoice();

      const pkrClient = await prisma.client.create({
        data: {
          workspaceId,
          name: 'Local Co',
          normalizedName: 'localco',
          billingCurrency: 'PKR',
        },
      });

      const result = expectOk(
        await actions.recordPayment({
          clientId: pkrClient.id,
          invoiceId: null,
          amount: '5000',
          currency: 'PKR',
          paymentDate: dayOffset(0),
          method: 'CASH',
          reference: null,
          notes: null,
          allocations: [],
          idempotencyKey: 'key-currency-1',
        }),
      );

      // Nothing to allocate against, so the whole amount is held as credit.
      expect(result.unallocated).toBe('5000');
      const untouched = await prisma.invoice.findUniqueOrThrow({ where: { id: usdInvoice.id } });
      expect(untouched.amountPaid.toString()).toBe('0');
    });

    it('recalculates the balance when a payment is removed', async () => {
      const invoice = await issuedInvoice();
      const payment = expectOk(
        await actions.recordPayment({
          clientId,
          invoiceId: invoice.id,
          amount: '1100',
          currency: 'USD',
          paymentDate: dayOffset(0),
          method: 'BANK_TRANSFER',
          reference: null,
          notes: null,
          allocations: [],
          idempotencyKey: 'key-remove-1',
        }),
      );

      expectOk(await actions.deletePayment({ id: payment.id }));

      const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(updated.amountPaid.toString()).toBe('0');
      expect(updated.status).not.toBe('PAID');
    });

    it('refuses a role without payment:create', async () => {
      const invoice = await issuedInvoice();
      setActionContext(makeContext({ workspaceId, userId: staffUserId, role: 'STAFF' }));

      const result = await actions.recordPayment({
        clientId,
        invoiceId: invoice.id,
        amount: '100',
        currency: 'USD',
        paymentDate: dayOffset(0),
        method: 'CASH',
        reference: null,
        notes: null,
        allocations: [],
        idempotencyKey: 'key-forbidden-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('FORBIDDEN');
      expect(await prisma.payment.count()).toBe(0);
    });
  });

  describe('voiding and credit notes', () => {
    async function issuedInvoice() {
      const created = expectOk(await actions.createInvoice(draftInput()));
      expectOk(await actions.issueInvoice({ id: created.id, generatePdf: false }));
      return created;
    }

    it('voids an unpaid issued invoice with a reason', async () => {
      const invoice = await issuedInvoice();
      expectOk(await actions.voidInvoice({ id: invoice.id, reason: 'Raised in error' }));

      const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(updated.status).toBe('VOID');
      expect(updated.voidReason).toBe('Raised in error');
      expect(updated.voidedAt).not.toBeNull();
    });

    it('refuses to void an invoice that has payments', async () => {
      const invoice = await issuedInvoice();
      expectOk(
        await actions.recordPayment({
          clientId,
          invoiceId: invoice.id,
          amount: '100',
          currency: 'USD',
          paymentDate: dayOffset(0),
          method: 'CASH',
          reference: null,
          notes: null,
          allocations: [],
          idempotencyKey: 'key-void-guard',
        }),
      );

      const result = await actions.voidInvoice({ id: invoice.id, reason: 'Changed my mind' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('HAS_PAYMENTS');
    });

    it('reduces the balance with a credit note', async () => {
      const invoice = await issuedInvoice();
      expectOk(
        await actions.createCreditNote({
          invoiceId: invoice.id,
          amount: '100',
          reason: 'Goodwill adjustment',
        }),
      );

      const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(updated.creditedTotal.toString()).toBe('100');
      expect(updated.grandTotal.toString()).toBe('1100');
    });

    it('settles an invoice when payments plus credits cover it', async () => {
      const invoice = await issuedInvoice();
      expectOk(
        await actions.recordPayment({
          clientId,
          invoiceId: invoice.id,
          amount: '1000',
          currency: 'USD',
          paymentDate: dayOffset(0),
          method: 'BANK_TRANSFER',
          reference: null,
          notes: null,
          allocations: [],
          idempotencyKey: 'key-settle-1',
        }),
      );
      expectOk(
        await actions.createCreditNote({
          invoiceId: invoice.id,
          amount: '100',
          reason: 'Agreed discount',
        }),
      );

      const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(updated.status).toBe('PAID');
    });

    it('refuses a credit note larger than the outstanding balance', async () => {
      const invoice = await issuedInvoice();
      const result = await actions.createCreditNote({
        invoiceId: invoice.id,
        amount: '5000',
        reason: 'Too much',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('EXCEEDS_BALANCE');
    });
  });

  describe('overdue recalculation', () => {
    it('moves a past-due unpaid invoice to OVERDUE', async () => {
      const created = expectOk(
        await actions.createInvoice({
          ...draftInput(),
          issueDate: '2020-01-01',
          dueDate: '2020-01-15',
        }),
      );
      expectOk(await actions.issueInvoice({ id: created.id, generatePdf: false }));

      const changed = await actions.refreshOverdueInvoices(workspaceId);
      expect(changed).toBe(1);

      const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: created.id } });
      expect(updated.status).toBe('OVERDUE');
    });

    it('leaves a future-dated invoice alone', async () => {
      const created = expectOk(
        await actions.createInvoice({
          ...draftInput(),
          issueDate: '2099-01-01',
          dueDate: '2099-01-15',
        }),
      );
      expectOk(await actions.issueInvoice({ id: created.id, generatePdf: false }));

      await actions.refreshOverdueInvoices(workspaceId);
      const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: created.id } });
      expect(updated.status).toBe('SENT');
    });
  });
});
