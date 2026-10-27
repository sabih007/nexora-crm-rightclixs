'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { ActionError, defineAction } from '@/lib/action';
import { recordAudit } from '@/lib/audit';
import { assertClientAccess, assertProjectAccess } from '@/lib/auth/guard';
import { fromDateInput } from '@/lib/dates';
import { advanceChargeDate } from './forecast';
import {
  cardIdSchema,
  cardInputSchema,
  expenseIdSchema,
  expenseInputSchema,
  linkIdSchema,
  markLinkRemovedSchema,
  platformIdSchema,
  platformInputSchema,
  platformLinkSchema,
  recordChargeSchema,
  subscriptionIdSchema,
  subscriptionInputSchema,
  updateCardSchema,
  updateExpenseSchema,
  updatePlatformSchema,
  updateSubscriptionSchema,
} from './schemas';

/**
 * Card inventory, platform registry, subscriptions and actual expenses.
 *
 * Two things this module deliberately never does:
 *  • store anything beyond a card's last four digits and non-secret metadata;
 *  • claim to have changed anything on an external service. Marking a card
 *    "removed" from a platform records *our* record of the removal, and the
 *    wording in the UI and audit log says exactly that.
 */

function toDate(value: string | null | undefined): Date | null {
  return value ? fromDateInput(value) : null;
}

// ---------------------------------------------------------------------------
// Payment cards
// ---------------------------------------------------------------------------

export const createCard = defineAction({
  name: 'card.create',
  permission: 'card:create',
  input: cardInputSchema,
  handler: async ({ input, ctx }) => {
    const card = await prisma.paymentCard.create({
      data: {
        workspaceId: ctx.workspaceId,
        nickname: input.nickname,
        issuer: input.issuer,
        brand: input.brand,
        last4: input.last4,
        expiryMonth: input.expiryMonth ?? null,
        expiryYear: input.expiryYear ?? null,
        ownerId: input.ownerId ?? null,
        status: input.status,
        notes: input.notes ?? null,
      },
      select: { id: true, nickname: true, last4: true, issuer: true, brand: true },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'card.created',
      entityType: 'PaymentCard',
      entityId: card.id,
      summary: `${card.nickname} ···· ${card.last4}`,
      after: { nickname: card.nickname, issuer: card.issuer, brand: card.brand, last4: card.last4 },
    });

    revalidatePath('/subscriptions/cards');
    return { id: card.id };
  },
});

export const updateCard = defineAction({
  name: 'card.update',
  permission: 'card:update',
  input: updateCardSchema,
  handler: async ({ input, ctx }) => {
    const before = await prisma.paymentCard.findFirst({
      where: { id: input.id, workspaceId: ctx.workspaceId },
      select: { nickname: true, issuer: true, brand: true, last4: true, status: true },
    });
    if (!before) throw new ActionError('Card not found.', { code: 'NOT_FOUND' });

    const data = input.data;
    await prisma.paymentCard.update({
      where: { id: input.id },
      data: {
        nickname: data.nickname,
        issuer: data.issuer,
        brand: data.brand,
        last4: data.last4,
        expiryMonth: data.expiryMonth ?? null,
        expiryYear: data.expiryYear ?? null,
        ownerId: data.ownerId ?? null,
        status: data.status,
        notes: data.notes ?? null,
      },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'card.updated',
      entityType: 'PaymentCard',
      entityId: input.id,
      summary: `${data.nickname} ···· ${data.last4}`,
      before,
      after: {
        nickname: data.nickname,
        issuer: data.issuer,
        brand: data.brand,
        last4: data.last4,
        status: data.status,
      },
    });

    revalidatePath('/subscriptions/cards');
    return { id: input.id };
  },
});

export const deleteCard = defineAction({
  name: 'card.delete',
  permission: 'card:delete',
  input: cardIdSchema,
  handler: async ({ input, ctx }) => {
    const card = await prisma.paymentCard.findFirst({
      where: { id: input.id, workspaceId: ctx.workspaceId },
      select: {
        nickname: true,
        last4: true,
        _count: { select: { subscriptions: true, platformLinks: true } },
      },
    });
    if (!card) throw new ActionError('Card not found.', { code: 'NOT_FOUND' });

    if (card._count.subscriptions > 0) {
      throw new ActionError(
        `${card.nickname} is still attached to ${card._count.subscriptions} subscription(s). Move them to another card first, or mark this card cancelled.`,
        { code: 'CARD_IN_USE' },
      );
    }

    await prisma.paymentCard.delete({ where: { id: input.id } });
    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'card.deleted',
      entityType: 'PaymentCard',
      entityId: input.id,
      summary: `${card.nickname} ···· ${card.last4}`,
    });

    revalidatePath('/subscriptions/cards');
    return { id: input.id };
  },
});

// ---------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------

export const createPlatform = defineAction({
  name: 'platform.create',
  permission: 'platform:create',
  input: platformInputSchema,
  handler: async ({ input, ctx }) => {
    const platform = await prisma.platform.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: input.name,
        websiteUrl: input.websiteUrl ?? null,
        category: input.category,
        accountIdentifier: input.accountIdentifier ?? null,
        cancellationUrl: input.cancellationUrl ?? null,
        ownerId: input.ownerId ?? null,
        notes: input.notes ?? null,
      },
      select: { id: true, name: true, category: true },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'platform.created',
      entityType: 'Platform',
      entityId: platform.id,
      summary: platform.name,
      after: platform,
    });

    revalidatePath('/subscriptions/platforms');
    return { id: platform.id };
  },
});

export const updatePlatform = defineAction({
  name: 'platform.update',
  permission: 'platform:update',
  input: updatePlatformSchema,
  handler: async ({ input, ctx }) => {
    const before = await prisma.platform.findFirst({
      where: { id: input.id, workspaceId: ctx.workspaceId },
      select: { name: true, category: true, accountIdentifier: true },
    });
    if (!before) throw new ActionError('Platform not found.', { code: 'NOT_FOUND' });

    const data = input.data;
    await prisma.platform.update({
      where: { id: input.id },
      data: {
        name: data.name,
        websiteUrl: data.websiteUrl ?? null,
        category: data.category,
        accountIdentifier: data.accountIdentifier ?? null,
        cancellationUrl: data.cancellationUrl ?? null,
        ownerId: data.ownerId ?? null,
        notes: data.notes ?? null,
      },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'platform.updated',
      entityType: 'Platform',
      entityId: input.id,
      summary: data.name,
      before,
      after: { name: data.name, category: data.category },
    });

    revalidatePath('/subscriptions/platforms');
    return { id: input.id };
  },
});

export const deletePlatform = defineAction({
  name: 'platform.delete',
  permission: 'platform:delete',
  input: platformIdSchema,
  handler: async ({ input, ctx }) => {
    const platform = await prisma.platform.findFirst({
      where: { id: input.id, workspaceId: ctx.workspaceId },
      select: { name: true, _count: { select: { subscriptions: true } } },
    });
    if (!platform) throw new ActionError('Platform not found.', { code: 'NOT_FOUND' });

    if (platform._count.subscriptions > 0) {
      throw new ActionError(
        `${platform.name} still has ${platform._count.subscriptions} subscription(s) recorded against it.`,
        { code: 'PLATFORM_IN_USE' },
      );
    }

    await prisma.platform.delete({ where: { id: input.id } });
    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'platform.deleted',
      entityType: 'Platform',
      entityId: input.id,
      summary: platform.name,
    });

    revalidatePath('/subscriptions/platforms');
    return { id: input.id };
  },
});

// ---------------------------------------------------------------------------
// Card ↔ platform links: "where is this card saved?"
// ---------------------------------------------------------------------------

export const linkCardToPlatform = defineAction({
  name: 'platformlink.create',
  permission: 'platformlink:manage',
  input: platformLinkSchema,
  handler: async ({ input, ctx }) => {
    const [platform, card] = await Promise.all([
      prisma.platform.findFirst({
        where: { id: input.platformId, workspaceId: ctx.workspaceId },
        select: { name: true },
      }),
      prisma.paymentCard.findFirst({
        where: { id: input.cardId, workspaceId: ctx.workspaceId },
        select: { nickname: true, last4: true },
      }),
    ]);
    if (!platform || !card)
      throw new ActionError('Platform or card not found.', { code: 'NOT_FOUND' });

    const link = await prisma.platformCardLink.upsert({
      where: {
        workspaceId_platformId_cardId: {
          workspaceId: ctx.workspaceId,
          platformId: input.platformId,
          cardId: input.cardId,
        },
      },
      create: {
        workspaceId: ctx.workspaceId,
        platformId: input.platformId,
        cardId: input.cardId,
        status: input.status,
        linkedAt: toDate(input.linkedAt) ?? new Date(),
        lastVerifiedAt: new Date(),
        responsibleId: input.responsibleId ?? ctx.user.id,
        notes: input.notes ?? null,
      },
      update: {
        status: input.status,
        linkedAt: toDate(input.linkedAt) ?? new Date(),
        removedAt: null,
        lastVerifiedAt: new Date(),
        responsibleId: input.responsibleId ?? ctx.user.id,
        notes: input.notes ?? null,
      },
      select: { id: true },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'platformlink.created',
      entityType: 'PlatformCardLink',
      entityId: link.id,
      summary: `${card.nickname} ···· ${card.last4} recorded as saved on ${platform.name}`,
    });

    revalidatePath('/subscriptions/cards');
    revalidatePath('/subscriptions/platforms');
    return { id: link.id };
  },
});

/**
 * Record that a card has been removed from a platform.
 *
 * This updates *our* inventory only. It does not and cannot remove the card
 * from the external service — the audit entry and the UI both say so.
 */
export const markLinkRemoved = defineAction({
  name: 'platformlink.removed',
  permission: 'platformlink:manage',
  input: markLinkRemovedSchema,
  handler: async ({ input, ctx }) => {
    const link = await prisma.platformCardLink.findFirst({
      where: { id: input.id, workspaceId: ctx.workspaceId },
      include: {
        platform: { select: { name: true } },
        card: { select: { nickname: true, last4: true } },
      },
    });
    if (!link) throw new ActionError('Link not found.', { code: 'NOT_FOUND' });

    await prisma.platformCardLink.update({
      where: { id: input.id },
      data: {
        status: 'REMOVED',
        removedAt: fromDateInput(input.removedAt),
        lastVerifiedAt: new Date(),
        responsibleId: ctx.user.id,
        notes: input.notes ?? link.notes,
      },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'platformlink.removed',
      entityType: 'PlatformCardLink',
      entityId: input.id,
      summary:
        `${link.card.nickname} ···· ${link.card.last4} marked removed from ${link.platform.name} ` +
        `in this inventory (no change was made on ${link.platform.name} itself)`,
      before: { status: link.status },
      after: { status: 'REMOVED', removedAt: input.removedAt },
    });

    revalidatePath('/subscriptions/cards');
    revalidatePath('/subscriptions/platforms');
    return { id: input.id };
  },
});

export const verifyLink = defineAction({
  name: 'platformlink.verified',
  permission: 'platformlink:manage',
  input: linkIdSchema,
  handler: async ({ input, ctx }) => {
    const link = await prisma.platformCardLink.findFirst({
      where: { id: input.id, workspaceId: ctx.workspaceId },
      include: {
        platform: { select: { name: true } },
        card: { select: { nickname: true, last4: true } },
      },
    });
    if (!link) throw new ActionError('Link not found.', { code: 'NOT_FOUND' });

    await prisma.platformCardLink.update({
      where: { id: input.id },
      data: { lastVerifiedAt: new Date(), status: 'ACTIVE', responsibleId: ctx.user.id },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'platformlink.verified',
      entityType: 'PlatformCardLink',
      entityId: input.id,
      summary: `${link.card.nickname} ···· ${link.card.last4} confirmed still saved on ${link.platform.name}`,
    });

    revalidatePath('/subscriptions/cards');
    revalidatePath('/subscriptions/platforms');
    return { id: input.id };
  },
});

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const createSubscription = defineAction({
  name: 'subscription.create',
  permission: 'subscription:create',
  input: subscriptionInputSchema,
  handler: async ({ input, ctx }) => {
    if (input.clientId) await assertClientAccess(ctx, input.clientId);
    if (input.projectId) await assertProjectAccess(ctx, input.projectId);

    const platform = await prisma.platform.findFirst({
      where: { id: input.platformId, workspaceId: ctx.workspaceId },
      select: { name: true },
    });
    if (!platform) throw new ActionError('Platform not found.', { code: 'NOT_FOUND' });

    const subscription = await prisma.subscription.create({
      data: {
        workspaceId: ctx.workspaceId,
        platformId: input.platformId,
        cardId: input.cardId ?? null,
        projectId: input.projectId ?? null,
        clientId: input.clientId ?? null,
        planName: input.planName,
        amount: input.amount,
        currency: input.currency,
        cadence: input.cadence,
        intervalDays: input.intervalDays ?? null,
        nextChargeAt: fromDateInput(input.nextChargeAt),
        startedAt: fromDateInput(input.startedAt),
        endsAt: toDate(input.endsAt),
        trialEndsAt: toDate(input.trialEndsAt),
        autoRenew: input.autoRenew,
        status: input.status,
        category: input.category,
        costCenter: input.costCenter ?? null,
        noticeDays: input.noticeDays ?? null,
        taxInclusive: input.taxInclusive,
        notes: input.notes ?? null,
      },
      select: { id: true, planName: true, amount: true, currency: true, cadence: true },
    });

    // Recording the subscription implies the card is saved on that platform.
    if (input.cardId) {
      await prisma.platformCardLink.upsert({
        where: {
          workspaceId_platformId_cardId: {
            workspaceId: ctx.workspaceId,
            platformId: input.platformId,
            cardId: input.cardId,
          },
        },
        create: {
          workspaceId: ctx.workspaceId,
          platformId: input.platformId,
          cardId: input.cardId,
          status: 'ACTIVE',
          linkedAt: new Date(),
          lastVerifiedAt: new Date(),
          responsibleId: ctx.user.id,
          notes: 'Created automatically with a subscription.',
        },
        update: {},
      });
    }

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'subscription.created',
      entityType: 'Subscription',
      entityId: subscription.id,
      summary: `${platform.name} — ${subscription.planName} (${subscription.currency} ${subscription.amount.toString()} ${subscription.cadence.toLowerCase()})`,
      after: {
        planName: subscription.planName,
        amount: subscription.amount,
        currency: subscription.currency,
        cadence: subscription.cadence,
      },
    });

    revalidatePath('/subscriptions');
    return { id: subscription.id };
  },
});

export const updateSubscription = defineAction({
  name: 'subscription.update',
  permission: 'subscription:update',
  input: updateSubscriptionSchema,
  handler: async ({ input, ctx }) => {
    const before = await prisma.subscription.findFirst({
      where: { id: input.id, workspaceId: ctx.workspaceId },
      select: {
        planName: true,
        amount: true,
        currency: true,
        cadence: true,
        status: true,
        nextChargeAt: true,
      },
    });
    if (!before) throw new ActionError('Subscription not found.', { code: 'NOT_FOUND' });

    const data = input.data;
    if (data.clientId) await assertClientAccess(ctx, data.clientId);
    if (data.projectId) await assertProjectAccess(ctx, data.projectId);

    await prisma.subscription.update({
      where: { id: input.id },
      data: {
        platformId: data.platformId,
        cardId: data.cardId ?? null,
        projectId: data.projectId ?? null,
        clientId: data.clientId ?? null,
        planName: data.planName,
        amount: data.amount,
        currency: data.currency,
        cadence: data.cadence,
        intervalDays: data.intervalDays ?? null,
        nextChargeAt: fromDateInput(data.nextChargeAt),
        startedAt: fromDateInput(data.startedAt),
        endsAt: toDate(data.endsAt),
        trialEndsAt: toDate(data.trialEndsAt),
        autoRenew: data.autoRenew,
        status: data.status,
        category: data.category,
        costCenter: data.costCenter ?? null,
        noticeDays: data.noticeDays ?? null,
        taxInclusive: data.taxInclusive,
        notes: data.notes ?? null,
      },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'subscription.updated',
      entityType: 'Subscription',
      entityId: input.id,
      summary: `${data.planName} (${data.currency} ${data.amount})`,
      before,
      after: {
        planName: data.planName,
        amount: data.amount,
        currency: data.currency,
        cadence: data.cadence,
        status: data.status,
        nextChargeAt: data.nextChargeAt,
      },
    });

    revalidatePath('/subscriptions');
    revalidatePath(`/subscriptions/${input.id}`);
    return { id: input.id };
  },
});

export const deleteSubscription = defineAction({
  name: 'subscription.delete',
  permission: 'subscription:delete',
  input: subscriptionIdSchema,
  handler: async ({ input, ctx }) => {
    const subscription = await prisma.subscription.findFirst({
      where: { id: input.id, workspaceId: ctx.workspaceId },
      select: { planName: true, _count: { select: { expenses: true } } },
    });
    if (!subscription) throw new ActionError('Subscription not found.', { code: 'NOT_FOUND' });

    if (subscription._count.expenses > 0) {
      throw new ActionError(
        `${subscription.planName} has ${subscription._count.expenses} recorded expense(s). Mark it cancelled rather than deleting it, so the spend history survives.`,
        { code: 'HAS_EXPENSES' },
      );
    }

    await prisma.subscription.delete({ where: { id: input.id } });
    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'subscription.deleted',
      entityType: 'Subscription',
      entityId: input.id,
      summary: subscription.planName,
    });

    revalidatePath('/subscriptions');
    return { id: input.id };
  },
});

/**
 * Record that a forecast charge actually happened.
 *
 * Writes a real `Expense` and rolls the schedule forward. The forecast and
 * the expense stay separate records — the forecast is never retrospectively
 * treated as spend.
 */
export const recordSubscriptionCharge = defineAction({
  name: 'subscription.record_charge',
  permission: 'expense:create',
  input: recordChargeSchema,
  handler: async ({ input, ctx }) => {
    const subscription = await prisma.subscription.findFirst({
      where: { id: input.subscriptionId, workspaceId: ctx.workspaceId },
      include: { platform: { select: { name: true } } },
    });
    if (!subscription) throw new ActionError('Subscription not found.', { code: 'NOT_FOUND' });

    const result = await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          workspaceId: ctx.workspaceId,
          subscriptionId: subscription.id,
          projectId: subscription.projectId,
          clientId: subscription.clientId,
          amount: input.amount,
          currency: subscription.currency,
          paidAt: fromDateInput(input.paidAt),
          category: subscription.category,
          description: `${subscription.platform.name} — ${subscription.planName}`,
          reference: input.reference ?? null,
          createdById: ctx.user.id,
        },
        select: { id: true },
      });

      let nextChargeAt = subscription.nextChargeAt;
      if (input.advanceSchedule) {
        nextChargeAt = advanceChargeDate(
          subscription.nextChargeAt,
          subscription.cadence,
          subscription.intervalDays,
        );
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { nextChargeAt },
        });
      }

      await recordAudit(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.user.id,
          action: 'expense.created',
          entityType: 'Expense',
          entityId: expense.id,
          summary: `${subscription.platform.name} — ${subscription.currency} ${input.amount} paid`,
          after: { amount: input.amount, currency: subscription.currency, paidAt: input.paidAt },
        },
        tx,
      );

      return { expenseId: expense.id, nextChargeAt };
    });

    revalidatePath('/subscriptions');
    revalidatePath(`/subscriptions/${input.subscriptionId}`);
    return result;
  },
});

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const createExpense = defineAction({
  name: 'expense.create',
  permission: 'expense:create',
  input: expenseInputSchema,
  handler: async ({ input, ctx }) => {
    if (input.clientId) await assertClientAccess(ctx, input.clientId);
    if (input.projectId) await assertProjectAccess(ctx, input.projectId);

    const expense = await prisma.expense.create({
      data: {
        workspaceId: ctx.workspaceId,
        subscriptionId: input.subscriptionId ?? null,
        projectId: input.projectId ?? null,
        clientId: input.clientId ?? null,
        amount: input.amount,
        currency: input.currency,
        paidAt: fromDateInput(input.paidAt),
        category: input.category,
        description: input.description,
        reference: input.reference ?? null,
        createdById: ctx.user.id,
      },
      select: { id: true, description: true, amount: true, currency: true },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'expense.created',
      entityType: 'Expense',
      entityId: expense.id,
      summary: `${expense.description} — ${expense.currency} ${expense.amount.toString()}`,
      after: { amount: expense.amount, currency: expense.currency },
    });

    revalidatePath('/subscriptions/expenses');
    return { id: expense.id };
  },
});

export const updateExpense = defineAction({
  name: 'expense.update',
  permission: 'expense:update',
  input: updateExpenseSchema,
  handler: async ({ input, ctx }) => {
    const before = await prisma.expense.findFirst({
      where: { id: input.id, workspaceId: ctx.workspaceId },
      select: { amount: true, currency: true, description: true, paidAt: true },
    });
    if (!before) throw new ActionError('Expense not found.', { code: 'NOT_FOUND' });

    const data = input.data;
    await prisma.expense.update({
      where: { id: input.id },
      data: {
        subscriptionId: data.subscriptionId ?? null,
        projectId: data.projectId ?? null,
        clientId: data.clientId ?? null,
        amount: data.amount,
        currency: data.currency,
        paidAt: fromDateInput(data.paidAt),
        category: data.category,
        description: data.description,
        reference: data.reference ?? null,
      },
    });

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'expense.updated',
      entityType: 'Expense',
      entityId: input.id,
      summary: data.description,
      before,
      after: { amount: data.amount, currency: data.currency, description: data.description },
    });

    revalidatePath('/subscriptions/expenses');
    return { id: input.id };
  },
});

export const deleteExpense = defineAction({
  name: 'expense.delete',
  permission: 'expense:delete',
  input: expenseIdSchema,
  handler: async ({ input, ctx }) => {
    const expense = await prisma.expense.findFirst({
      where: { id: input.id, workspaceId: ctx.workspaceId },
      select: { description: true, amount: true, currency: true },
    });
    if (!expense) throw new ActionError('Expense not found.', { code: 'NOT_FOUND' });

    await prisma.expense.delete({ where: { id: input.id } });
    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'expense.deleted',
      entityType: 'Expense',
      entityId: input.id,
      summary: `${expense.description} — ${expense.currency} ${expense.amount.toString()}`,
      before: { amount: expense.amount, currency: expense.currency },
    });

    revalidatePath('/subscriptions/expenses');
    return { id: input.id };
  },
});
