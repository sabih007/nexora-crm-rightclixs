import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { resetTestData, setupTestDatabase, teardownTestDatabase } from '../helpers/db';
import { mockActionEnvironment } from '../helpers/action-context';

mockActionEnvironment();

/**
 * Renewal reminders.
 *
 * The property that matters most: running the job twice must not notify
 * anyone twice. That is enforced by a unique `dedupeKey`, so these tests
 * exercise the real database constraint rather than a mock.
 */

let prisma: PrismaClient;
let reminders: typeof import('@/features/subscriptions/reminders');

function utcDay(offsetDays: number): Date {
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(base + offsetDays * 86_400_000);
}

describe('renewal reminders', () => {
  let workspaceId: string;
  let platformId: string;

  beforeAll(async () => {
    prisma = await setupTestDatabase();
    reminders = await import('@/features/subscriptions/reminders');
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();

    const workspace = await prisma.workspace.create({
      data: { name: 'Reminder Office', baseCurrency: 'PKR', timezone: 'UTC' },
    });
    workspaceId = workspace.id;

    await prisma.user.create({
      data: {
        name: 'Finance',
        email: 'finance@example.com',
        memberships: { create: { workspaceId, role: 'FINANCE' } },
      },
    });

    const platform = await prisma.platform.create({
      data: { workspaceId, name: 'Cloudhost' },
    });
    platformId = platform.id;

    for (const daysBefore of [30, 7, 1]) {
      await prisma.reminderRule.create({
        data: { workspaceId, entityType: 'subscription', daysBefore, channel: 'IN_APP' },
      });
    }
  });

  async function makeSubscription(daysUntilCharge: number, overrides = {}) {
    return prisma.subscription.create({
      data: {
        workspaceId,
        platformId,
        planName: 'Business',
        amount: '249',
        currency: 'USD',
        cadence: 'MONTHLY',
        nextChargeAt: utcDay(daysUntilCharge),
        startedAt: utcDay(-365),
        status: 'ACTIVE',
        category: 'Hosting',
        ...overrides,
      },
    });
  }

  it('fires for a subscription charging exactly N days out', async () => {
    await makeSubscription(7);

    const result = await reminders.runRenewalReminders(workspaceId);

    expect(result.created).toBe(1);
    expect(result.notified).toBe(1);

    const notification = await prisma.notification.findFirst({
      where: { workspaceId, type: 'RENEWAL_REMINDER' },
    });
    expect(notification?.title).toContain('renews in 7 days');
    expect(notification?.body).toContain('Business');
  });

  it('does not fire for a date no rule covers', async () => {
    await makeSubscription(5);
    const result = await reminders.runRenewalReminders(workspaceId);
    expect(result.created).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('is idempotent across repeated runs', async () => {
    await makeSubscription(7);

    const first = await reminders.runRenewalReminders(workspaceId);
    const second = await reminders.runRenewalReminders(workspaceId);
    const third = await reminders.runRenewalReminders(workspaceId);

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.skippedDuplicate).toBe(1);
    expect(third.skippedDuplicate).toBe(1);

    // Exactly one notification, no matter how often the job runs.
    expect(await prisma.notification.count()).toBe(1);
    expect(await prisma.subscriptionReminder.count()).toBe(1);
  });

  it('fires separately for each configured offset', async () => {
    await makeSubscription(30);
    const at30 = await reminders.runRenewalReminders(workspaceId);
    expect(at30.created).toBe(1);

    // Move the charge closer: the 7-day rule is a distinct reminder.
    await prisma.subscription.updateMany({ data: { nextChargeAt: utcDay(7) } });
    const at7 = await reminders.runRenewalReminders(workspaceId);
    expect(at7.created).toBe(1);

    expect(await prisma.subscriptionReminder.count()).toBe(2);
  });

  it('treats a new charge cycle as a new reminder', async () => {
    const subscription = await makeSubscription(7);
    await reminders.runRenewalReminders(workspaceId);

    // Next month's charge, same 7-day offset — a different cycle.
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { nextChargeAt: utcDay(37) },
    });
    await prisma.reminderRule.create({
      data: { workspaceId, entityType: 'subscription', daysBefore: 37, channel: 'IN_APP' },
    });

    const second = await reminders.runRenewalReminders(workspaceId);
    expect(second.created).toBe(1);
    expect(await prisma.subscriptionReminder.count()).toBe(2);
  });

  it('ignores paused and cancelled subscriptions', async () => {
    await makeSubscription(7, { status: 'PAUSED' });
    await makeSubscription(7, { status: 'CANCELLED' });

    const result = await reminders.runRenewalReminders(workspaceId);
    expect(result.created).toBe(0);
  });

  it('includes a trial subscription', async () => {
    await makeSubscription(7, { status: 'TRIAL' });
    const result = await reminders.runRenewalReminders(workspaceId);
    expect(result.created).toBe(1);
  });

  it('does nothing when every rule is disabled', async () => {
    await makeSubscription(7);
    await prisma.reminderRule.updateMany({ where: { workspaceId }, data: { enabled: false } });

    const result = await reminders.runRenewalReminders(workspaceId);
    expect(result.created).toBe(0);
  });

  it('mentions the cancellation deadline when a notice period applies', async () => {
    await makeSubscription(30, { noticeDays: 14 });
    await reminders.runRenewalReminders(workspaceId);

    const notification = await prisma.notification.findFirst({ where: { workspaceId } });
    expect(notification?.body).toContain('cancel by');
  });

  it('does not leak reminders between workspaces', async () => {
    const other = await prisma.workspace.create({
      data: { name: 'Other Office', baseCurrency: 'USD', timezone: 'UTC' },
    });
    const otherPlatform = await prisma.platform.create({
      data: { workspaceId: other.id, name: 'Other platform' },
    });
    await prisma.subscription.create({
      data: {
        workspaceId: other.id,
        platformId: otherPlatform.id,
        planName: 'Other plan',
        amount: '10',
        currency: 'USD',
        cadence: 'MONTHLY',
        nextChargeAt: utcDay(7),
        startedAt: utcDay(-30),
      },
    });

    await makeSubscription(7);
    const result = await reminders.runRenewalReminders(workspaceId);

    expect(result.created).toBe(1);
    const notifications = await prisma.notification.findMany();
    expect(notifications.every((n) => n.workspaceId === workspaceId)).toBe(true);
  });
});

describe('calendarTodayIn', () => {
  beforeAll(async () => {
    reminders = await import('@/features/subscriptions/reminders');
  });

  it('resolves the local calendar day for a timezone', () => {
    // 23:30 UTC on 1 June is already 2 June in Karachi (UTC+5).
    const instant = new Date('2026-06-01T23:30:00Z');
    expect(reminders.calendarTodayIn('Asia/Karachi', instant).toISOString().slice(0, 10)).toBe(
      '2026-06-02',
    );
    expect(reminders.calendarTodayIn('UTC', instant).toISOString().slice(0, 10)).toBe('2026-06-01');
  });

  it('falls back to UTC for an unknown timezone instead of throwing', () => {
    const instant = new Date('2026-06-01T12:00:00Z');
    expect(reminders.calendarTodayIn('Not/AZone', instant).toISOString().slice(0, 10)).toBe(
      '2026-06-01',
    );
  });
});
