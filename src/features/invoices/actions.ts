'use server';

import { revalidatePath } from 'next/cache';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { ActionError, defineAction } from '@/lib/action';
import { recordAudit } from '@/lib/audit';
import { assertClientAccess, assertInvoiceAccess, assertProjectAccess } from '@/lib/auth/guard';
import { fromDateInput, todayUtc } from '@/lib/dates';
import { dec, moneyEquals, roundMoney, sum } from '@/lib/money';
import { getWorkspaceSettings } from '@/lib/workspace';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email';
import { renderInvoicePdf } from './pdf';
import { storeGeneratedFile } from '@/lib/storage';
import {
  allocatePayment,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  formatInvoiceNumber,
  outstandingBalance,
  validateAllocations,
} from './calculations';
import {
  creditNoteSchema,
  invoiceIdSchema,
  invoiceInputSchema,
  issueInvoiceSchema,
  paymentIdSchema,
  paymentInputSchema,
  sendInvoiceSchema,
  updateInvoiceSchema,
  voidInvoiceSchema,
} from './schemas';

/**
 * Invoice and payment mutations.
 *
 * Invariants enforced here, not in the UI:
 *  • Totals are always recomputed server-side from the line items.
 *  • An issued invoice's amounts are frozen; edits are refused and the
 *    correction path is a credit note or a replacement invoice.
 *  • Payment creation is idempotent and transactional, so a double submit
 *    or a retried request can never produce two payments.
 */

/** Recompute an invoice's cached totals and status inside a transaction. */
async function refreshInvoiceTotals(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<void> {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      currency: true,
      status: true,
      dueDate: true,
      grandTotal: true,
      allocations: { select: { allocatedAmount: true } },
      creditNotes: { select: { amount: true } },
    },
  });

  const amountPaid = roundMoney(
    sum(invoice.allocations.map((a) => a.allocatedAmount.toString())),
    invoice.currency,
  );
  const creditedTotal = roundMoney(
    sum(invoice.creditNotes.map((c) => c.amount.toString())),
    invoice.currency,
  );

  const status = deriveInvoiceStatus({
    currentStatus: invoice.status,
    grandTotal: invoice.grandTotal.toString(),
    amountPaid: amountPaid.toString(),
    creditedTotal: creditedTotal.toString(),
    dueDate: invoice.dueDate,
    currency: invoice.currency,
  });

  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid: amountPaid.toString(),
      creditedTotal: creditedTotal.toString(),
      status,
      paidAt: status === 'PAID' ? new Date() : null,
    },
  });
}

// ---------------------------------------------------------------------------
// Draft lifecycle
// ---------------------------------------------------------------------------

export const createInvoice = defineAction({
  name: 'invoice.create',
  permission: 'invoice:create',
  input: invoiceInputSchema,
  handler: async ({ input, ctx }) => {
    await assertClientAccess(ctx, input.clientId);
    if (input.projectId) await assertProjectAccess(ctx, input.projectId);

    const totals = computeInvoiceTotals({
      lines: input.lines,
      currency: input.currency,
      taxMode: input.taxMode,
      invoiceTaxRate: input.invoiceTaxRate,
    });

    const settings = await getWorkspaceSettings(ctx.workspaceId);

    const invoice = await prisma.$transaction(async (tx) => {
      // Reserve the next number atomically; the unique index is the backstop.
      const workspace = await tx.workspace.update({
        where: { id: ctx.workspaceId },
        data: { invoiceNextNo: { increment: 1 } },
        select: { invoicePrefix: true, invoiceNextNo: true },
      });

      const invoiceNumber = formatInvoiceNumber({
        prefix: workspace.invoicePrefix,
        sequence: workspace.invoiceNextNo - 1,
        padding: settings.invoiceNumberPadding,
        includeYear: settings.invoiceNumberIncludeYear,
        year: fromDateInput(input.issueDate).getUTCFullYear(),
      });

      const created = await tx.invoice.create({
        data: {
          workspaceId: ctx.workspaceId,
          clientId: input.clientId,
          projectId: input.projectId ?? null,
          invoiceNumber,
          status: 'DRAFT',
          currency: input.currency,
          issueDate: fromDateInput(input.issueDate),
          dueDate: fromDateInput(input.dueDate),
          taxMode: input.taxMode,
          invoiceTaxRate: input.invoiceTaxRate,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxTotal: totals.taxTotal,
          grandTotal: totals.grandTotal,
          terms: input.terms ?? settings.defaultInvoiceTerms,
          notes: input.notes ?? null,
          lines: {
            create: totals.lines.map((line, index) => ({
              description: input.lines[index]?.description ?? '',
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountAmount: line.discountAmount,
              taxRate: line.taxRate,
              lineSubtotal: line.lineSubtotal,
              lineTax: line.lineTax,
              lineTotal: line.lineTotal,
              position: index,
            })),
          },
        },
        select: { id: true, invoiceNumber: true, grandTotal: true, currency: true },
      });

      await recordAudit(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.user.id,
          action: 'invoice.created',
          entityType: 'Invoice',
          entityId: created.id,
          summary: created.invoiceNumber,
          after: { grandTotal: created.grandTotal, currency: created.currency },
        },
        tx,
      );

      return created;
    });

    revalidatePath('/invoices');
    return { id: invoice.id, invoiceNumber: invoice.invoiceNumber };
  },
});

export const updateInvoice = defineAction({
  name: 'invoice.update',
  permission: 'invoice:update',
  input: updateInvoiceSchema,
  handler: async ({ input, ctx }) => {
    await assertInvoiceAccess(ctx, input.id);

    const existing = await prisma.invoice.findUniqueOrThrow({
      where: { id: input.id },
      select: {
        status: true,
        invoiceNumber: true,
        issuedAt: true,
        grandTotal: true,
        currency: true,
      },
    });

    // The central guarantee of the module: an issued invoice's figures are
    // immutable. Corrections go through a credit note or a new invoice.
    if (existing.status !== 'DRAFT') {
      throw new ActionError(
        `${existing.invoiceNumber} has already been issued and cannot be edited. Issue a credit note, or void it and raise a replacement.`,
        { code: 'INVOICE_ISSUED' },
      );
    }

    const data = input.data;
    await assertClientAccess(ctx, data.clientId);
    if (data.projectId) await assertProjectAccess(ctx, data.projectId);

    const totals = computeInvoiceTotals({
      lines: data.lines,
      currency: data.currency,
      taxMode: data.taxMode,
      invoiceTaxRate: data.invoiceTaxRate,
    });

    await prisma.$transaction(async (tx) => {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: input.id } });
      await tx.invoice.update({
        where: { id: input.id },
        data: {
          clientId: data.clientId,
          projectId: data.projectId ?? null,
          currency: data.currency,
          issueDate: fromDateInput(data.issueDate),
          dueDate: fromDateInput(data.dueDate),
          taxMode: data.taxMode,
          invoiceTaxRate: data.invoiceTaxRate,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxTotal: totals.taxTotal,
          grandTotal: totals.grandTotal,
          terms: data.terms ?? null,
          notes: data.notes ?? null,
          lines: {
            create: totals.lines.map((line, index) => ({
              description: data.lines[index]?.description ?? '',
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountAmount: line.discountAmount,
              taxRate: line.taxRate,
              lineSubtotal: line.lineSubtotal,
              lineTax: line.lineTax,
              lineTotal: line.lineTotal,
              position: index,
            })),
          },
        },
      });

      await recordAudit(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.user.id,
          action: 'invoice.updated',
          entityType: 'Invoice',
          entityId: input.id,
          summary: existing.invoiceNumber,
          before: { grandTotal: existing.grandTotal, currency: existing.currency },
          after: { grandTotal: totals.grandTotal, currency: data.currency },
        },
        tx,
      );
    });

    revalidatePath('/invoices');
    revalidatePath(`/invoices/${input.id}`);
    return { id: input.id };
  },
});

export const deleteDraftInvoice = defineAction({
  name: 'invoice.delete',
  permission: 'invoice:delete',
  input: invoiceIdSchema,
  handler: async ({ input, ctx }) => {
    await assertInvoiceAccess(ctx, input.id);

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: input.id },
      select: { status: true, invoiceNumber: true },
    });

    if (invoice.status !== 'DRAFT') {
      throw new ActionError(
        `${invoice.invoiceNumber} has been issued. Issued invoices are voided, never deleted, so the number sequence stays auditable.`,
        { code: 'INVOICE_ISSUED' },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.invoice.delete({ where: { id: input.id } });
      await recordAudit(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.user.id,
          action: 'invoice.deleted',
          entityType: 'Invoice',
          entityId: input.id,
          summary: invoice.invoiceNumber,
        },
        tx,
      );
    });

    revalidatePath('/invoices');
    return { id: input.id };
  },
});

// ---------------------------------------------------------------------------
// Issuing
// ---------------------------------------------------------------------------

export const issueInvoice = defineAction({
  name: 'invoice.issue',
  permission: 'invoice:issue',
  input: issueInvoiceSchema,
  handler: async ({ input, ctx }) => {
    await assertInvoiceAccess(ctx, input.id);

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: input.id },
      include: {
        lines: { orderBy: { position: 'asc' } },
        client: true,
      },
    });

    if (invoice.status !== 'DRAFT') {
      throw new ActionError(`${invoice.invoiceNumber} has already been issued.`, {
        code: 'ALREADY_ISSUED',
      });
    }
    if (invoice.lines.length === 0) {
      throw new ActionError('Add at least one line item before issuing.', { code: 'NO_LINES' });
    }

    // Recompute from the stored lines and refuse to issue if the cached
    // totals disagree — a mismatch means something wrote them directly.
    const recomputed = computeInvoiceTotals({
      lines: invoice.lines.map((l) => ({
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(),
        discountAmount: l.discountAmount.toString(),
        taxRate: l.taxRate.toString(),
      })),
      currency: invoice.currency,
      taxMode: invoice.taxMode,
      invoiceTaxRate: invoice.invoiceTaxRate.toString(),
    });

    if (!moneyEquals(recomputed.grandTotal, invoice.grandTotal.toString(), invoice.currency)) {
      logger.error('Invoice totals mismatch at issue time', {
        invoiceId: invoice.id,
        stored: invoice.grandTotal.toString(),
        recomputed: recomputed.grandTotal,
      });
      throw new ActionError(
        'The stored totals do not match the line items. Reopen and save the invoice before issuing.',
        { code: 'TOTALS_MISMATCH' },
      );
    }

    const clientSnapshot = {
      name: invoice.client.name,
      email: invoice.client.email,
      phone: invoice.client.phone,
      taxId: invoice.client.taxId,
      address: invoice.client.addressJson,
      capturedAt: new Date().toISOString(),
    };

    const issuedSnapshot = {
      invoiceNumber: invoice.invoiceNumber,
      currency: invoice.currency,
      issueDate: invoice.issueDate.toISOString(),
      dueDate: invoice.dueDate.toISOString(),
      taxMode: invoice.taxMode,
      invoiceTaxRate: invoice.invoiceTaxRate.toString(),
      subtotal: recomputed.subtotal,
      discountTotal: recomputed.discountTotal,
      taxTotal: recomputed.taxTotal,
      grandTotal: recomputed.grandTotal,
      lines: invoice.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(),
        discountAmount: l.discountAmount.toString(),
        taxRate: l.taxRate.toString(),
        lineSubtotal: l.lineSubtotal.toString(),
        lineTax: l.lineTax.toString(),
        lineTotal: l.lineTotal.toString(),
      })),
      issuedAt: new Date().toISOString(),
      issuedBy: ctx.user.name,
    };

    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: input.id },
        data: {
          status: 'SENT',
          issuedAt: new Date(),
          clientSnapshotJson: clientSnapshot as Prisma.InputJsonValue,
          issuedSnapshotJson: issuedSnapshot as Prisma.InputJsonValue,
        },
      });

      await recordAudit(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.user.id,
          action: 'invoice.issued',
          entityType: 'Invoice',
          entityId: input.id,
          summary: `${invoice.invoiceNumber} · ${invoice.currency} ${recomputed.grandTotal}`,
          after: { grandTotal: recomputed.grandTotal, currency: invoice.currency },
        },
        tx,
      );
    });

    // The PDF is generated after the snapshot is committed; a failure here
    // must not undo the issue, so it is reported but not fatal.
    if (input.generatePdf) {
      try {
        await generateAndStoreInvoicePdf(input.id, ctx.workspaceId, ctx.user.id);
      } catch (error) {
        logger.error('Invoice PDF generation failed after issue', { invoiceId: input.id, error });
      }
    }

    revalidatePath('/invoices');
    revalidatePath(`/invoices/${input.id}`);
    return { id: input.id, invoiceNumber: invoice.invoiceNumber };
  },
});

/** Render the branded PDF and store it privately against the invoice. */
async function generateAndStoreInvoicePdf(
  invoiceId: string,
  workspaceId: string,
  userId: string,
): Promise<string> {
  const [invoice, workspace] = await Promise.all([
    prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { lines: { orderBy: { position: 'asc' } }, client: true },
    }),
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
  ]);

  const pdf = await renderInvoicePdf({ invoice, workspace });

  const file = await storeGeneratedFile({
    workspaceId,
    uploadedById: userId,
    buffer: pdf,
    originalName: `${invoice.invoiceNumber}.pdf`,
    mimeType: 'application/pdf',
    clientId: invoice.clientId,
    projectId: invoice.projectId,
  });

  await prisma.invoice.update({ where: { id: invoiceId }, data: { pdfFileId: file.id } });
  return file.id;
}

export const regenerateInvoicePdf = defineAction({
  name: 'invoice.regenerate_pdf',
  permission: 'invoice:download_pdf',
  input: invoiceIdSchema,
  handler: async ({ input, ctx }) => {
    await assertInvoiceAccess(ctx, input.id);
    const fileId = await generateAndStoreInvoicePdf(input.id, ctx.workspaceId, ctx.user.id);
    revalidatePath(`/invoices/${input.id}`);
    return { fileId };
  },
});

export const sendInvoice = defineAction({
  name: 'invoice.send',
  permission: 'invoice:send',
  input: sendInvoiceSchema,
  handler: async ({ input, ctx }) => {
    await assertInvoiceAccess(ctx, input.id);

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: input.id },
      include: { client: { select: { name: true, email: true } } },
    });

    if (invoice.status === 'DRAFT') {
      throw new ActionError('Issue the invoice before sending it.', { code: 'NOT_ISSUED' });
    }
    if (invoice.status === 'VOID' || invoice.status === 'CANCELLED') {
      throw new ActionError('This invoice is no longer active.', { code: 'INACTIVE' });
    }

    const recipient = input.recipientEmail ?? invoice.client.email;

    let delivery: 'sent' | 'recorded' = 'recorded';
    let deliveryNote = 'Marked as sent. No email was dispatched.';

    if (!input.markOnly) {
      if (!recipient) {
        throw new ActionError(
          'This client has no billing email. Add one, supply a recipient, or mark the invoice sent manually.',
          { code: 'NO_RECIPIENT' },
        );
      }

      const result = await sendEmail({
        to: recipient,
        subject: `Invoice ${invoice.invoiceNumber}`,
        text:
          `${input.message ?? ''}\n\n` +
          `Invoice ${invoice.invoiceNumber}\n` +
          `Amount: ${invoice.currency} ${invoice.grandTotal.toString()}\n` +
          `Due: ${invoice.dueDate.toISOString().slice(0, 10)}\n`,
      });

      // Never claim delivery the adapter did not perform.
      delivery = result.delivered ? 'sent' : 'recorded';
      deliveryNote = result.delivered
        ? `Email dispatched to ${recipient} via ${result.driver}.`
        : `Email was not dispatched (${result.driver} driver): ${result.note}`;
    }

    await prisma.invoice.update({ where: { id: input.id }, data: { sentAt: new Date() } });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'invoice.sent',
      entityType: 'Invoice',
      entityId: input.id,
      summary: `${invoice.invoiceNumber} — ${deliveryNote}`,
    });

    revalidatePath(`/invoices/${input.id}`);
    return { delivery, note: deliveryNote };
  },
});

export const voidInvoice = defineAction({
  name: 'invoice.void',
  permission: 'invoice:void',
  input: voidInvoiceSchema,
  handler: async ({ input, ctx }) => {
    await assertInvoiceAccess(ctx, input.id);

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: input.id },
      select: {
        status: true,
        invoiceNumber: true,
        amountPaid: true,
        currency: true,
        grandTotal: true,
      },
    });

    if (invoice.status === 'DRAFT') {
      throw new ActionError('A draft is deleted, not voided.', { code: 'IS_DRAFT' });
    }
    if (invoice.status === 'VOID') {
      throw new ActionError('This invoice is already void.', { code: 'ALREADY_VOID' });
    }
    if (dec(invoice.amountPaid.toString()).greaterThan(0)) {
      throw new ActionError(
        `${invoice.invoiceNumber} has payments recorded against it. Issue a credit note instead so the payment history stays intact.`,
        { code: 'HAS_PAYMENTS' },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: input.id },
        data: { status: 'VOID', voidedAt: new Date(), voidReason: input.reason },
      });
      await recordAudit(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.user.id,
          action: 'invoice.voided',
          entityType: 'Invoice',
          entityId: input.id,
          summary: `${invoice.invoiceNumber} — ${input.reason}`,
          before: { status: invoice.status, grandTotal: invoice.grandTotal },
          after: { status: 'VOID', reason: input.reason },
        },
        tx,
      );
    });

    revalidatePath('/invoices');
    revalidatePath(`/invoices/${input.id}`);
    return { id: input.id };
  },
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const recordPayment = defineAction({
  name: 'payment.create',
  permission: 'payment:create',
  input: paymentInputSchema,
  handler: async ({ input, ctx }) => {
    await assertClientAccess(ctx, input.clientId);

    const result = await prisma.$transaction(async (tx) => {
      // Idempotency: the unique (workspaceId, scope, key) index means a
      // retried submit collides here rather than creating a second payment.
      const existingKey = await tx.idempotencyKey.findUnique({
        where: {
          workspaceId_scope_key: {
            workspaceId: ctx.workspaceId,
            scope: 'payment.create',
            key: input.idempotencyKey,
          },
        },
        select: { resultId: true },
      });
      if (existingKey?.resultId) {
        return { id: existingKey.resultId, duplicate: true as const };
      }

      // Candidate invoices, oldest first, in the payment's currency only —
      // a PKR payment can never be applied to a USD invoice.
      const openInvoices = await tx.invoice.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          clientId: input.clientId,
          currency: input.currency,
          status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
        orderBy: { issueDate: 'asc' },
        select: {
          id: true,
          currency: true,
          grandTotal: true,
          amountPaid: true,
          creditedTotal: true,
        },
      });

      const balances: Record<string, string> = {};
      for (const inv of openInvoices) {
        balances[inv.id] = outstandingBalance({
          grandTotal: inv.grandTotal.toString(),
          amountPaid: inv.amountPaid.toString(),
          creditedTotal: inv.creditedTotal.toString(),
          currency: inv.currency,
        });
      }

      let allocations: { invoiceId: string; allocatedAmount: string }[];
      let unallocated: string;

      if (input.allocations.length > 0) {
        const check = validateAllocations({
          paymentAmount: input.amount,
          allocations: input.allocations,
          balances,
          currency: input.currency,
        });
        if (!check.valid) throw new ActionError(check.reason, { code: 'BAD_ALLOCATION' });

        allocations = input.allocations;
        unallocated = roundMoney(
          dec(input.amount).minus(sum(input.allocations.map((a) => a.allocatedAmount))),
          input.currency,
        ).toString();
      } else {
        // Auto-allocate oldest-first, preferring the invoice the user opened.
        const ordered = input.invoiceId
          ? [
              ...openInvoices.filter((i) => i.id === input.invoiceId),
              ...openInvoices.filter((i) => i.id !== input.invoiceId),
            ]
          : openInvoices;

        const auto = allocatePayment(
          input.amount,
          ordered.map((i) => ({ invoiceId: i.id, balance: balances[i.id] ?? '0' })),
          input.currency,
        );
        allocations = auto.allocations;
        unallocated = auto.unallocated;
      }

      const payment = await tx.payment.create({
        data: {
          workspaceId: ctx.workspaceId,
          clientId: input.clientId,
          invoiceId: allocations[0]?.invoiceId ?? input.invoiceId ?? null,
          amount: input.amount,
          currency: input.currency,
          paymentDate: fromDateInput(input.paymentDate),
          method: input.method,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          createdById: ctx.user.id,
          allocations: { create: allocations },
        },
        select: { id: true },
      });

      await tx.idempotencyKey.create({
        data: {
          workspaceId: ctx.workspaceId,
          scope: 'payment.create',
          key: input.idempotencyKey,
          resultId: payment.id,
        },
      });

      for (const allocation of allocations) {
        await refreshInvoiceTotals(tx, allocation.invoiceId);
      }

      await recordAudit(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.user.id,
          action: 'payment.created',
          entityType: 'Payment',
          entityId: payment.id,
          summary: `${input.currency} ${input.amount}${
            dec(unallocated).greaterThan(0) ? ` (${unallocated} unallocated)` : ''
          }`,
          after: {
            amount: input.amount,
            currency: input.currency,
            allocations: allocations.length,
          },
        },
        tx,
      );

      return { id: payment.id, duplicate: false as const, unallocated };
    });

    revalidatePath('/invoices');
    if (input.invoiceId) revalidatePath(`/invoices/${input.invoiceId}`);
    revalidatePath(`/clients/${input.clientId}`);
    return result;
  },
});

export const deletePayment = defineAction({
  name: 'payment.delete',
  permission: 'payment:delete',
  input: paymentIdSchema,
  handler: async ({ input, ctx }) => {
    const payment = await prisma.payment.findFirst({
      where: { id: input.id, workspaceId: ctx.workspaceId },
      select: {
        id: true,
        amount: true,
        currency: true,
        clientId: true,
        allocations: { select: { invoiceId: true } },
      },
    });
    if (!payment) throw new ActionError('Payment not found.', { code: 'NOT_FOUND' });

    const invoiceIds = payment.allocations.map((a) => a.invoiceId);

    await prisma.$transaction(async (tx) => {
      await tx.payment.delete({ where: { id: input.id } });
      for (const invoiceId of invoiceIds) {
        await refreshInvoiceTotals(tx, invoiceId);
      }
      await recordAudit(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.user.id,
          action: 'payment.deleted',
          entityType: 'Payment',
          entityId: input.id,
          summary: `${payment.currency} ${payment.amount.toString()}`,
          before: { amount: payment.amount, currency: payment.currency },
        },
        tx,
      );
    });

    revalidatePath('/invoices');
    revalidatePath(`/clients/${payment.clientId}`);
    return { id: input.id };
  },
});

export const createCreditNote = defineAction({
  name: 'creditnote.create',
  permission: 'creditnote:create',
  input: creditNoteSchema,
  handler: async ({ input, ctx }) => {
    await assertInvoiceAccess(ctx, input.invoiceId);

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: input.invoiceId },
      select: {
        invoiceNumber: true,
        status: true,
        currency: true,
        grandTotal: true,
        amountPaid: true,
        creditedTotal: true,
      },
    });

    if (invoice.status === 'DRAFT') {
      throw new ActionError('A draft invoice can simply be edited.', { code: 'IS_DRAFT' });
    }

    const remaining = outstandingBalance({
      grandTotal: invoice.grandTotal.toString(),
      amountPaid: invoice.amountPaid.toString(),
      creditedTotal: invoice.creditedTotal.toString(),
      currency: invoice.currency,
    });

    if (dec(input.amount).greaterThan(dec(remaining))) {
      throw new ActionError(
        `A credit note cannot exceed the ${invoice.currency} ${remaining} still outstanding on ${invoice.invoiceNumber}.`,
        { code: 'EXCEEDS_BALANCE' },
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const count = await tx.creditNote.count({ where: { workspaceId: ctx.workspaceId } });
      const number = `CN-${todayUtc().getUTCFullYear()}-${String(count + 1).padStart(4, '0')}`;

      const note = await tx.creditNote.create({
        data: {
          workspaceId: ctx.workspaceId,
          invoiceId: input.invoiceId,
          number,
          currency: invoice.currency,
          amount: input.amount,
          reason: input.reason,
        },
        select: { id: true, number: true },
      });

      await refreshInvoiceTotals(tx, input.invoiceId);

      await recordAudit(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.user.id,
          action: 'creditnote.created',
          entityType: 'CreditNote',
          entityId: note.id,
          summary: `${note.number} against ${invoice.invoiceNumber} — ${invoice.currency} ${input.amount}`,
          after: { amount: input.amount, reason: input.reason },
        },
        tx,
      );

      return note;
    });

    revalidatePath(`/invoices/${input.invoiceId}`);
    return created;
  },
});

/**
 * Recompute OVERDUE across the workspace. Called by the daily cron so the
 * list reflects reality even if nobody opened an invoice.
 */
export async function refreshOverdueInvoices(workspaceId: string): Promise<number> {
  const candidates = await prisma.invoice.findMany({
    where: {
      workspaceId,
      status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
    },
    select: {
      id: true,
      status: true,
      currency: true,
      dueDate: true,
      grandTotal: true,
      amountPaid: true,
      creditedTotal: true,
    },
  });

  let changed = 0;
  for (const invoice of candidates) {
    const next = deriveInvoiceStatus({
      currentStatus: invoice.status,
      grandTotal: invoice.grandTotal.toString(),
      amountPaid: invoice.amountPaid.toString(),
      creditedTotal: invoice.creditedTotal.toString(),
      dueDate: invoice.dueDate,
      currency: invoice.currency,
    });
    if (next !== invoice.status) {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: next } });
      changed += 1;
    }
  }
  return changed;
}
