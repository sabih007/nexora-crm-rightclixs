'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { ActionError, defineAction } from '@/lib/action';
import { recordAudit } from '@/lib/audit';
import { assertClientAccess } from '@/lib/auth/guard';
import { normalizeName } from '@/lib/utils';
import {
  archiveClientSchema,
  clientIdSchema,
  clientInputSchema,
  updateClientSchema,
} from './schemas';
import { findPotentialDuplicates } from './queries';

/**
 * Client mutations.
 *
 * Each action runs through `defineAction`, which authenticates, checks the
 * capability, validates the input and normalises errors. Object-level access
 * is asserted separately for anything addressed by id.
 */

function addressToJson(address: unknown): Prisma.InputJsonValue | undefined {
  if (!address || typeof address !== 'object') return undefined;
  const entries = Object.entries(address as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );
  return entries.length > 0 ? (Object.fromEntries(entries) as Prisma.InputJsonValue) : undefined;
}

export const createClient = defineAction({
  name: 'client.create',
  permission: 'client:create',
  input: clientInputSchema,
  handler: async ({ input, ctx }) => {
    if (!input.allowDuplicate) {
      const duplicates = await findPotentialDuplicates(ctx, {
        name: input.name,
        email: input.email,
      });
      if (duplicates.length > 0) {
        throw new ActionError(
          `A client named "${duplicates[0]?.name}" already exists. Review it, or confirm to create anyway.`,
          { code: 'DUPLICATE' },
        );
      }
    }

    const client = await prisma.$transaction(async (tx) => {
      const created = await tx.client.create({
        data: {
          workspaceId: ctx.workspaceId,
          type: input.type,
          name: input.name,
          normalizedName: normalizeName(input.name),
          email: input.email ?? null,
          phone: input.phone ?? null,
          website: input.website ?? null,
          billingCurrency: input.billingCurrency,
          taxId: input.taxId ?? null,
          status: input.status,
          tags: input.tags,
          notes: input.notes ?? null,
          addressJson: addressToJson(input.address),
          contacts: {
            create: input.contacts.map((c) => ({
              name: c.name,
              email: c.email ?? null,
              phone: c.phone ?? null,
              position: c.position ?? null,
              isPrimary: c.isPrimary,
            })),
          },
        },
        select: { id: true, name: true, status: true, billingCurrency: true },
      });

      await recordAudit(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.user.id,
          action: 'client.created',
          entityType: 'Client',
          entityId: created.id,
          summary: created.name,
          after: created,
        },
        tx,
      );

      return created;
    });

    revalidatePath('/clients');
    return { id: client.id };
  },
});

export const updateClient = defineAction({
  name: 'client.update',
  permission: 'client:update',
  input: updateClientSchema,
  handler: async ({ input, ctx }) => {
    await assertClientAccess(ctx, input.id);

    const before = await prisma.client.findUniqueOrThrow({
      where: { id: input.id },
      select: {
        name: true,
        email: true,
        phone: true,
        status: true,
        billingCurrency: true,
        taxId: true,
        tags: true,
      },
    });

    await prisma.$transaction(async (tx) => {
      await tx.client.update({
        where: { id: input.id },
        data: {
          type: input.type,
          name: input.name,
          normalizedName: normalizeName(input.name),
          email: input.email ?? null,
          phone: input.phone ?? null,
          website: input.website ?? null,
          billingCurrency: input.billingCurrency,
          taxId: input.taxId ?? null,
          status: input.status,
          tags: input.tags,
          notes: input.notes ?? null,
          addressJson: addressToJson(input.address),
        },
      });

      // Contacts are replaced wholesale: the form always submits the complete
      // list, and this keeps ordering and primary-flag changes consistent.
      const keepIds = input.contacts.map((c) => c.id).filter((id): id is string => Boolean(id));
      await tx.clientContact.deleteMany({
        where: { clientId: input.id, ...(keepIds.length > 0 ? { NOT: { id: { in: keepIds } } } : {}) },
      });
      for (const contact of input.contacts) {
        const data = {
          name: contact.name,
          email: contact.email ?? null,
          phone: contact.phone ?? null,
          position: contact.position ?? null,
          isPrimary: contact.isPrimary,
        };
        if (contact.id) {
          await tx.clientContact.update({ where: { id: contact.id }, data });
        } else {
          await tx.clientContact.create({ data: { ...data, clientId: input.id } });
        }
      }

      await recordAudit(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.user.id,
          action: 'client.updated',
          entityType: 'Client',
          entityId: input.id,
          summary: input.name,
          before,
          after: {
            name: input.name,
            email: input.email,
            phone: input.phone,
            status: input.status,
            billingCurrency: input.billingCurrency,
            taxId: input.taxId,
            tags: input.tags,
          },
        },
        tx,
      );
    });

    revalidatePath('/clients');
    revalidatePath(`/clients/${input.id}`);
    return { id: input.id };
  },
});

export const setClientArchived = defineAction({
  name: 'client.archive',
  permission: 'client:archive',
  input: archiveClientSchema,
  handler: async ({ input, ctx }) => {
    await assertClientAccess(ctx, input.id);

    const client = await prisma.client.update({
      where: { id: input.id },
      data: {
        archivedAt: input.archived ? new Date() : null,
        status: input.archived ? 'ARCHIVED' : 'ACTIVE',
      },
      select: { id: true, name: true },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: input.archived ? 'client.archived' : 'client.restored',
      entityType: 'Client',
      entityId: client.id,
      summary: client.name,
    });

    revalidatePath('/clients');
    revalidatePath(`/clients/${input.id}`);
    return { id: client.id, archived: input.archived };
  },
});

/**
 * Hard delete. Deliberately refuses when financial history exists — archiving
 * is the normal path, and an invoice must never lose its client.
 */
export const deleteClient = defineAction({
  name: 'client.delete',
  permission: 'client:delete',
  input: clientIdSchema,
  handler: async ({ input, ctx }) => {
    await assertClientAccess(ctx, input.id);

    const client = await prisma.client.findUniqueOrThrow({
      where: { id: input.id },
      select: {
        name: true,
        _count: { select: { invoices: true, payments: true, projects: true } },
      },
    });

    const { invoices, payments, projects } = client._count;
    if (invoices > 0 || payments > 0) {
      throw new ActionError(
        `"${client.name}" has ${invoices} invoice(s) and ${payments} payment(s). Financial history cannot be deleted — archive the client instead.`,
        { code: 'HAS_FINANCIAL_HISTORY' },
      );
    }
    if (projects > 0) {
      throw new ActionError(
        `"${client.name}" still has ${projects} project(s). Move or delete them first.`,
        { code: 'HAS_PROJECTS' },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.client.delete({ where: { id: input.id } });
      await recordAudit(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.user.id,
          action: 'client.deleted',
          entityType: 'Client',
          entityId: input.id,
          summary: client.name,
          before: { name: client.name },
        },
        tx,
      );
    });

    revalidatePath('/clients');
    return { id: input.id };
  },
});

/** Used by the create form to warn before submitting. */
export const checkClientDuplicates = defineAction({
  name: 'client.check_duplicates',
  permission: 'client:read',
  input: z.object({
    name: z.string().trim().min(1),
    email: z.string().trim().nullable().optional(),
    excludeId: z.uuid().optional(),
  }),
  handler: async ({ input, ctx }) =>
    findPotentialDuplicates(ctx, { name: input.name, email: input.email }, input.excludeId),
});
