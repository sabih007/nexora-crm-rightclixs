import 'server-only';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email';
import { addDays, formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { cancellationDeadline } from './forecast';

/**
 * Renewal reminders.
 *
 * Idempotency is structural, not best-effort: every reminder writes a row
 * whose `dedupeKey` is `subscriptionId:chargeDate:daysBefore:channel` under a
 * unique index. Running the job twice in a day — or a retried cron delivery —
 * collides on that key and sends nothing a second time.
 *
 * The job is timezone-aware in the sense that it compares calendar dates in
 * the workspace's declared timezone, so a reminder configured for "7 days
 * before" fires on the right local day rather than drifting with UTC.
 */

export interface ReminderRunResult {
  workspaceId: string;
  evaluated: number;
  created: number;
  skippedDuplicate: number;
  notified: number;
  emailed: number;
  errors: string[];
}

/** Today's calendar date in a given IANA timezone, as a UTC-midnight Date. */
export function calendarTodayIn(timezone: string, now: Date = new Date()): Date {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);

    const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? '01';
    return new Date(
      Date.UTC(Number(lookup('year')), Number(lookup('month')) - 1, Number(lookup('day'))),
    );
  } catch {
    // An invalid timezone must not take the whole job down. Fall back to the
    // UTC calendar day of the *same instant*, not of the wall clock.
    logger.warn('Unknown workspace timezone, falling back to UTC', { timezone });
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
}

/**
 * Evaluate renewal reminders for one workspace.
 *
 * For each enabled rule (30/14/7/1 days by default), finds the subscriptions
 * whose next charge lands exactly that many days from today and emits one
 * notification per recipient — once per charge cycle.
 */
export async function runRenewalReminders(workspaceId: string): Promise<ReminderRunResult> {
  const result: ReminderRunResult = {
    workspaceId,
    evaluated: 0,
    created: 0,
    skippedDuplicate: 0,
    notified: 0,
    emailed: 0,
    errors: [],
  };

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, timezone: true },
  });
  if (!workspace) {
    result.errors.push('Workspace not found');
    return result;
  }

  const today = calendarTodayIn(workspace.timezone);

  const rules = await prisma.reminderRule.findMany({
    where: { workspaceId, entityType: 'subscription', enabled: true },
    orderBy: { daysBefore: 'desc' },
  });
  if (rules.length === 0) return result;

  // Everyone who can see subscriptions gets renewal notices; email honours
  // the per-user opt-out.
  const recipients = await prisma.membership.findMany({
    where: {
      workspaceId,
      role: { in: ['OWNER', 'ADMIN', 'FINANCE'] },
      user: { status: 'ACTIVE' },
    },
    select: { user: { select: { id: true, name: true, email: true, emailOptOut: true } } },
  });

  for (const rule of rules) {
    const targetDate = addDays(today, rule.daysBefore);

    const subscriptions = await prisma.subscription.findMany({
      where: {
        workspaceId,
        status: { in: ['ACTIVE', 'TRIAL'] },
        nextChargeAt: targetDate,
      },
      include: {
        platform: { select: { name: true } },
        card: { select: { nickname: true, last4: true } },
      },
    });

    for (const subscription of subscriptions) {
      result.evaluated += 1;

      const dedupeKey = [
        subscription.id,
        subscription.nextChargeAt.toISOString().slice(0, 10),
        rule.daysBefore,
        rule.channel,
      ].join(':');

      const cancelBy = cancellationDeadline(subscription.nextChargeAt, subscription.noticeDays);
      const amount = formatMoney(subscription.amount.toString(), subscription.currency);

      const title =
        rule.daysBefore === 0
          ? `${subscription.platform.name} renews today`
          : `${subscription.platform.name} renews in ${rule.daysBefore} day${rule.daysBefore === 1 ? '' : 's'}`;

      const body =
        `${subscription.planName} · ${amount} on ${formatDate(subscription.nextChargeAt)}` +
        (subscription.card
          ? ` · ${subscription.card.nickname} ···· ${subscription.card.last4}`
          : '') +
        (cancelBy ? ` · cancel by ${formatDate(cancelBy)}` : '');

      try {
        // The unique dedupeKey is what makes a repeat run a no-op.
        await prisma.subscriptionReminder.create({
          data: {
            subscriptionId: subscription.id,
            daysBefore: rule.daysBefore,
            chargeDate: subscription.nextChargeAt,
            channel: rule.channel,
            dedupeKey,
          },
        });
        result.created += 1;
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          result.skippedDuplicate += 1;
          continue;
        }
        result.errors.push(`${subscription.id}: ${(error as Error).message}`);
        continue;
      }

      if (rule.channel === 'IN_APP') {
        await prisma.notification.createMany({
          data: recipients.map((r) => ({
            workspaceId,
            userId: r.user.id,
            type: 'RENEWAL_REMINDER' as const,
            title,
            body,
            link: `/subscriptions/${subscription.id}`,
          })),
        });
        result.notified += recipients.length;
      }

      if (rule.channel === 'EMAIL') {
        for (const recipient of recipients) {
          if (recipient.user.emailOptOut) continue;
          const sent = await sendEmail({
            to: recipient.user.email,
            subject: `${title} — ${workspace.name}`,
            text: `${title}\n\n${body}\n\nThis is a reminder from Nexora OS. No payment has been taken by this system.`,
          });
          if (sent.delivered) result.emailed += 1;
        }
      }
    }
  }

  logger.info('Renewal reminders evaluated', { ...result, errors: result.errors.length });
  return result;
}

/**
 * Overdue-invoice reminders, on the same idempotent pattern.
 * Fires on configured days past the due date.
 */
export async function runOverdueInvoiceReminders(
  workspaceId: string,
  offsets: number[],
): Promise<{ created: number; skippedDuplicate: number }> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { timezone: true },
  });
  const today = calendarTodayIn(workspace?.timezone ?? 'UTC');

  let created = 0;
  let skippedDuplicate = 0;

  const recipients = await prisma.membership.findMany({
    where: {
      workspaceId,
      role: { in: ['OWNER', 'ADMIN', 'FINANCE'] },
      user: { status: 'ACTIVE' },
    },
    select: { userId: true },
  });

  for (const offset of offsets) {
    const dueDate = addDays(today, -offset);

    const invoices = await prisma.invoice.findMany({
      where: {
        workspaceId,
        status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
        dueDate,
      },
      include: { client: { select: { name: true } } },
    });

    for (const invoice of invoices) {
      const dedupeKey = `${invoice.id}:${offset}`;
      try {
        await prisma.invoiceReminder.create({
          data: {
            invoiceId: invoice.id,
            offsetDays: offset,
            channel: 'IN_APP',
            dedupeKey,
          },
        });
        created += 1;
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          skippedDuplicate += 1;
          continue;
        }
        throw error;
      }

      const outstanding = invoice.grandTotal.minus(invoice.amountPaid).minus(invoice.creditedTotal);
      await prisma.notification.createMany({
        data: recipients.map((r) => ({
          workspaceId,
          userId: r.userId,
          type: 'INVOICE_OVERDUE' as const,
          title: `${invoice.invoiceNumber} is ${offset} day${offset === 1 ? '' : 's'} overdue`,
          body: `${invoice.client.name} · ${formatMoney(outstanding.toString(), invoice.currency)} outstanding`,
          link: `/invoices/${invoice.id}`,
        })),
      });
    }
  }

  return { created, skippedDuplicate };
}
