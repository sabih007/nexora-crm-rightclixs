import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

// Mirror Next.js env precedence for CLI tooling: .env.local overrides .env.
loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

/**
 * Remove the records the E2E run created.
 *
 * The suite drives the real UI against the real database, so every run leaves
 * behind clients, invoices, payments, cards, platforms and projects. Locally
 * that database is also the one holding the demo seed, and without this the
 * residue buries the demo data and — worse — inflates the figures on the
 * dashboard, the invoice list header and the reports. Repeated runs grow it
 * without bound.
 *
 * Everything the suite creates is named with an `E2E ` prefix by
 * `unique()` in `helpers.ts`, so this deletes by that marker and nothing else.
 * It never touches seeded `[DEMO]` records or anything a person entered.
 *
 * Set `E2E_KEEP_DATA=1` to skip it when you want to inspect what a failing
 * run produced.
 */

const MARKER = 'E2E ';

async function main() {
  if (process.env.E2E_KEEP_DATA === '1') {
    console.log('[e2e cleanup] E2E_KEEP_DATA=1 — leaving test records in place.');
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn('[e2e cleanup] Refusing to run against NODE_ENV=production.');
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.warn('[e2e cleanup] No DATABASE_URL — nothing to clean up.');
    return;
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const startsWith = { startsWith: MARKER };

  try {
    const clients = await prisma.client.findMany({
      where: { name: startsWith },
      select: { id: true },
    });
    const clientIds = clients.map((c) => c.id);

    const projects = await prisma.project.findMany({
      where: { name: startsWith },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);

    const invoices = await prisma.invoice.findMany({
      where: { clientId: { in: clientIds } },
      select: { id: true },
    });
    const invoiceIds = invoices.map((i) => i.id);

    const payments = await prisma.payment.findMany({
      where: { OR: [{ clientId: { in: clientIds } }, { allocations: { some: {} } }] },
      select: { id: true, clientId: true },
    });
    const paymentIds = payments.filter((p) => clientIds.includes(p.clientId)).map((p) => p.id);

    // Financial relationships are RESTRICT, so order matters: allocations
    // before payments, lines before invoices, invoices before clients.
    const counts = {
      allocations: (
        await prisma.paymentAllocation.deleteMany({
          where: { OR: [{ invoiceId: { in: invoiceIds } }, { paymentId: { in: paymentIds } }] },
        })
      ).count,
      reminders: (
        await prisma.invoiceReminder.deleteMany({ where: { invoiceId: { in: invoiceIds } } })
      ).count,
      creditNotes: (
        await prisma.creditNote.deleteMany({ where: { invoiceId: { in: invoiceIds } } })
      ).count,
      payments: (await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } })).count,
      invoiceLines: (
        await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } })
      ).count,
      invoices: (await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } })).count,

      taskComments: (
        await prisma.taskComment.deleteMany({ where: { task: { projectId: { in: projectIds } } } })
      ).count,
      tasks: (await prisma.task.deleteMany({ where: { projectId: { in: projectIds } } })).count,
      projectMembers: (
        await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } })
      ).count,
      expenses: (await prisma.expense.deleteMany({ where: { projectId: { in: projectIds } } }))
        .count,
      projects: (await prisma.project.deleteMany({ where: { id: { in: projectIds } } })).count,

      platformLinks: (
        await prisma.platformCardLink.deleteMany({
          where: { OR: [{ card: { nickname: startsWith } }, { platform: { name: startsWith } }] },
        })
      ).count,
      subscriptions: (
        await prisma.subscription.deleteMany({
          where: {
            OR: [
              { planName: startsWith },
              { platform: { name: startsWith } },
              { card: { nickname: startsWith } },
            ],
          },
        })
      ).count,
      cards: (await prisma.paymentCard.deleteMany({ where: { nickname: startsWith } })).count,
      platforms: (await prisma.platform.deleteMany({ where: { name: startsWith } })).count,

      contacts: (await prisma.clientContact.deleteMany({ where: { clientId: { in: clientIds } } }))
        .count,
      clients: (await prisma.client.deleteMany({ where: { id: { in: clientIds } } })).count,
    };

    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    if (total > 0) {
      const detail = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ');
      console.log(`[e2e cleanup] Removed ${total} records: ${detail}.`);
    } else {
      console.log('[e2e cleanup] Nothing to remove.');
    }
  } catch (error) {
    // A teardown failure must not mask the test result.
    console.warn('[e2e cleanup] Cleanup failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[e2e cleanup] Failed:', error);
  process.exit(1);
});
