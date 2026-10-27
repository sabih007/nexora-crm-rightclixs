'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ActionError, defineAction } from '@/lib/action';
import { recordAudit } from '@/lib/audit';
import { saveWorkspaceSettings } from '@/lib/workspace';
import { fromDateInput } from '@/lib/dates';
import { CURRENCY_REGEX } from '@/lib/money';
import { assignableRoles } from '@/lib/permissions';
import { hashPassword, generateToken } from '@/lib/auth/crypto';
import { revokeAllUserSessions } from '@/lib/auth/session';

/** Workspace settings, exchange rates, reminder rules and team management. */

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const updateWorkspace = defineAction({
  name: 'settings.workspace',
  permission: 'workspace:update',
  input: z.object({
    name: z.string().trim().min(1, 'Name the workspace.').max(160),
    baseCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(CURRENCY_REGEX, 'Use a 3-letter ISO currency code.'),
    timezone: z.string().trim().min(1).max(64),
    invoicePrefix: z
      .string()
      .trim()
      .min(1, 'An invoice prefix is required.')
      .max(10)
      .regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and hyphens only.'),
    addressLine1: optionalText(200),
    addressLine2: optionalText(200),
    city: optionalText(120),
    postalCode: optionalText(40),
    country: optionalText(120),
    taxId: optionalText(80),
    email: optionalText(254),
    phone: optionalText(60),
  }),
  handler: async ({ input, ctx }) => {
    const before = await prisma.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { name: true, baseCurrency: true, timezone: true, invoicePrefix: true },
    });

    // Changing the base currency re-bases every consolidated report, so it is
    // recorded explicitly rather than folded into a generic settings change.
    if (before.baseCurrency !== input.baseCurrency) {
      await recordAudit({
        workspaceId: ctx.workspaceId,
        actorId: ctx.user.id,
        action: 'settings.updated',
        entityType: 'Workspace',
        entityId: ctx.workspaceId,
        summary: `Base currency changed from ${before.baseCurrency} to ${input.baseCurrency}`,
        before: { baseCurrency: before.baseCurrency },
        after: { baseCurrency: input.baseCurrency },
      });
    }

    await prisma.workspace.update({
      where: { id: ctx.workspaceId },
      data: {
        name: input.name,
        baseCurrency: input.baseCurrency,
        timezone: input.timezone,
        invoicePrefix: input.invoicePrefix,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        city: input.city ?? null,
        postalCode: input.postalCode ?? null,
        country: input.country ?? null,
        taxId: input.taxId ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
      },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'settings.updated',
      entityType: 'Workspace',
      entityId: ctx.workspaceId,
      summary: 'Workspace details updated',
      before,
      after: {
        name: input.name,
        baseCurrency: input.baseCurrency,
        timezone: input.timezone,
        invoicePrefix: input.invoicePrefix,
      },
    });

    revalidatePath('/settings');
    return { ok: true };
  },
});

export const updateInvoiceDefaults = defineAction({
  name: 'settings.invoice_defaults',
  permission: 'settings:update',
  input: z.object({
    defaultPaymentTermDays: z.coerce.number().int().min(0).max(365),
    defaultTaxRate: z
      .string()
      .trim()
      .regex(/^\d{1,3}(\.\d{1,4})?$/, 'Enter a percentage.')
      .refine((v) => Number(v) <= 100, 'Tax rate cannot exceed 100%.'),
    defaultInvoiceTerms: z.string().trim().max(3000),
    defaultInvoiceNotes: z.string().trim().max(3000),
    invoiceNumberPadding: z.coerce.number().int().min(1).max(10),
    invoiceNumberIncludeYear: z.boolean(),
    renewalReminderDays: z.array(z.coerce.number().int().min(0).max(365)).max(10),
    invoiceReminderDays: z.array(z.coerce.number().int().min(0).max(365)).max(10),
  }),
  handler: async ({ input, ctx }) => {
    await saveWorkspaceSettings(ctx.workspaceId, input);

    // Reminder rules are rows, so the cron job can query them directly.
    await prisma.reminderRule.deleteMany({
      where: { workspaceId: ctx.workspaceId, entityType: 'subscription' },
    });
    for (const daysBefore of [...new Set(input.renewalReminderDays)]) {
      await prisma.reminderRule.create({
        data: { workspaceId: ctx.workspaceId, entityType: 'subscription', daysBefore, channel: 'IN_APP' },
      });
    }

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'settings.updated',
      entityType: 'Setting',
      summary: 'Invoice and reminder defaults updated',
      after: input,
    });

    revalidatePath('/settings');
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Exchange rates
// ---------------------------------------------------------------------------

export const addExchangeRate = defineAction({
  name: 'exchangerate.create',
  permission: 'exchangerate:manage',
  input: z
    .object({
      baseCurrency: z.string().trim().toUpperCase().regex(CURRENCY_REGEX, 'Use a 3-letter code.'),
      quoteCurrency: z.string().trim().toUpperCase().regex(CURRENCY_REGEX, 'Use a 3-letter code.'),
      rate: z
        .string()
        .trim()
        .regex(/^\d+(\.\d{1,10})?$/, 'Enter a positive rate.')
        .refine((v) => Number(v) > 0, 'The rate must be above zero.'),
      effectiveDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.'),
      source: z.string().trim().min(1).max(60).default('manual'),
    })
    .refine((v) => v.baseCurrency !== v.quoteCurrency, {
      message: 'The two currencies must differ.',
      path: ['quoteCurrency'],
    }),
  handler: async ({ input, ctx }) => {
    const effectiveDate = fromDateInput(input.effectiveDate);

    const rate = await prisma.exchangeRate.upsert({
      where: {
        baseCurrency_quoteCurrency_effectiveDate: {
          baseCurrency: input.baseCurrency,
          quoteCurrency: input.quoteCurrency,
          effectiveDate,
        },
      },
      create: {
        baseCurrency: input.baseCurrency,
        quoteCurrency: input.quoteCurrency,
        rate: input.rate,
        effectiveDate,
        source: input.source,
      },
      update: { rate: input.rate, source: input.source },
      select: { id: true },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'exchangerate.created',
      entityType: 'ExchangeRate',
      entityId: rate.id,
      summary: `1 ${input.baseCurrency} = ${input.rate} ${input.quoteCurrency} from ${input.effectiveDate} (${input.source})`,
    });

    revalidatePath('/settings/exchange-rates');
    revalidatePath('/reports');
    revalidatePath('/dashboard');
    return { id: rate.id };
  },
});

export const deleteExchangeRate = defineAction({
  name: 'exchangerate.delete',
  permission: 'exchangerate:manage',
  input: z.object({ id: z.uuid() }),
  handler: async ({ input, ctx }) => {
    const rate = await prisma.exchangeRate.findUnique({ where: { id: input.id } });
    if (!rate) throw new ActionError('Rate not found.', { code: 'NOT_FOUND' });

    await prisma.exchangeRate.delete({ where: { id: input.id } });
    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'exchangerate.deleted',
      entityType: 'ExchangeRate',
      entityId: input.id,
      summary: `${rate.baseCurrency}→${rate.quoteCurrency} at ${rate.rate.toString()} (${rate.effectiveDate.toISOString().slice(0, 10)})`,
    });

    revalidatePath('/settings/exchange-rates');
    return { id: input.id };
  },
});

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export const inviteTeamMember = defineAction({
  name: 'team.invite',
  permission: 'team:invite',
  input: z.object({
    name: z.string().trim().min(1, 'Enter a name.').max(120),
    email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
    role: z.enum(['OWNER', 'ADMIN', 'FINANCE', 'MANAGER', 'STAFF']),
  }),
  handler: async ({ input, ctx }) => {
    if (!assignableRoles(ctx.role).includes(input.role)) {
      throw new ActionError(`Your role cannot assign the ${input.role} role.`, {
        code: 'ROLE_NOT_ASSIGNABLE',
      });
    }

    const existing = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, memberships: { where: { workspaceId: ctx.workspaceId } } },
    });

    if (existing && existing.memberships.length > 0) {
      throw new ActionError('That person is already a member of this workspace.', {
        code: 'ALREADY_MEMBER',
      });
    }

    // A temporary password is generated and returned once. There is no email
    // invitation flow yet, so the administrator passes it on out of band —
    // the UI says exactly that rather than implying an email was sent.
    const temporaryPassword = generateToken(12);

    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: { memberships: { create: { workspaceId: ctx.workspaceId, role: input.role } } },
          select: { id: true },
        })
      : await prisma.user.create({
          data: {
            name: input.name,
            email: input.email,
            passwordHash: await hashPassword(temporaryPassword),
            status: 'ACTIVE',
            memberships: { create: { workspaceId: ctx.workspaceId, role: input.role } },
          },
          select: { id: true },
        });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'team.invited',
      entityType: 'User',
      entityId: user.id,
      summary: `${input.name} (${input.email}) added as ${input.role}`,
      after: { email: input.email, role: input.role },
    });

    revalidatePath('/team');
    return {
      id: user.id,
      // Only for a brand-new account; an existing user keeps their password.
      temporaryPassword: existing ? null : temporaryPassword,
    };
  },
});

export const changeTeamMemberRole = defineAction({
  name: 'team.update_role',
  permission: 'team:update_role',
  input: z.object({
    userId: z.uuid(),
    role: z.enum(['OWNER', 'ADMIN', 'FINANCE', 'MANAGER', 'STAFF']),
  }),
  handler: async ({ input, ctx }) => {
    if (!assignableRoles(ctx.role).includes(input.role)) {
      throw new ActionError(`Your role cannot assign the ${input.role} role.`, {
        code: 'ROLE_NOT_ASSIGNABLE',
      });
    }

    const membership = await prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: input.userId } },
      include: { user: { select: { name: true } } },
    });
    if (!membership) throw new ActionError('That person is not a member.', { code: 'NOT_FOUND' });

    // An admin must not be able to demote or alter an owner.
    if (membership.role === 'OWNER' && ctx.role !== 'OWNER') {
      throw new ActionError('Only an owner can change an owner’s role.', { code: 'FORBIDDEN' });
    }

    // The workspace must always retain at least one owner.
    if (membership.role === 'OWNER' && input.role !== 'OWNER') {
      const owners = await prisma.membership.count({
        where: { workspaceId: ctx.workspaceId, role: 'OWNER' },
      });
      if (owners <= 1) {
        throw new ActionError(
          'This is the only owner. Promote someone else to owner first.',
          { code: 'LAST_OWNER' },
        );
      }
    }

    await prisma.membership.update({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: input.userId } },
      data: { role: input.role },
    });

    // A role change alters what their live sessions may do, so end them.
    await revokeAllUserSessions(input.userId);

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'team.role_changed',
      entityType: 'User',
      entityId: input.userId,
      summary: `${membership.user.name}: ${membership.role} → ${input.role} (their sessions were ended)`,
      before: { role: membership.role },
      after: { role: input.role },
    });

    revalidatePath('/team');
    return { ok: true };
  },
});

export const removeTeamMember = defineAction({
  name: 'team.remove',
  permission: 'team:remove',
  input: z.object({ userId: z.uuid() }),
  handler: async ({ input, ctx }) => {
    if (input.userId === ctx.user.id) {
      throw new ActionError('You cannot remove yourself from the workspace.', {
        code: 'SELF_REMOVAL',
      });
    }

    const membership = await prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: input.userId } },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!membership) throw new ActionError('That person is not a member.', { code: 'NOT_FOUND' });

    if (membership.role === 'OWNER' && ctx.role !== 'OWNER') {
      throw new ActionError('Only an owner can remove an owner.', { code: 'FORBIDDEN' });
    }
    if (membership.role === 'OWNER') {
      const owners = await prisma.membership.count({
        where: { workspaceId: ctx.workspaceId, role: 'OWNER' },
      });
      if (owners <= 1) {
        throw new ActionError('The workspace must keep at least one owner.', {
          code: 'LAST_OWNER',
        });
      }
    }

    // Membership is removed and sessions ended; the user row is kept so
    // their authorship on invoices, payments and audit entries survives.
    await prisma.membership.delete({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: input.userId } },
    });
    await prisma.user.update({ where: { id: input.userId }, data: { status: 'SUSPENDED' } });
    await revokeAllUserSessions(input.userId);

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'team.removed',
      entityType: 'User',
      entityId: input.userId,
      summary: `${membership.user.name} removed from the workspace; their historic records are kept`,
    });

    revalidatePath('/team');
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const updateProfile = defineAction({
  name: 'settings.profile',
  input: z.object({
    name: z.string().trim().min(1, 'Enter your name.').max(120),
    timezone: z.string().trim().max(64).nullable().optional(),
    emailOptOut: z.boolean().default(false),
  }),
  handler: async ({ input, ctx }) => {
    await prisma.user.update({
      where: { id: ctx.user.id },
      data: {
        name: input.name,
        timezone: input.timezone ?? null,
        emailOptOut: input.emailOptOut,
      },
    });

    revalidatePath('/settings/profile');
    return { ok: true };
  },
});
