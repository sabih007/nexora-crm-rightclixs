import { NextResponse } from 'next/server';
import {
  allWorkspaceIds,
  authorizeCronRequest,
  runJob,
  unauthorizedCronResponse,
} from '@/lib/cron';
import { runOverdueInvoiceReminders, runRenewalReminders } from '@/features/subscriptions/reminders';
import { refreshOverdueInvoices } from '@/features/invoices/actions';
import { getWorkspaceSettings } from '@/lib/workspace';
import { pruneRateLimits } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Daily maintenance.
 *
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Schedule once a day (Vercel Cron, systemd timer, or any scheduler that can
 * send a header). Running it more than once is safe: reminders are
 * deduplicated by a unique key and the job itself short-circuits if it has
 * already succeeded in the last 12 hours.
 */
export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) return unauthorizedCronResponse();

  const workspaceIds = await allWorkspaceIds();
  const results: Record<string, unknown>[] = [];

  for (const workspaceId of workspaceIds) {
    const outcome = await runJob(
      { jobKey: 'daily-maintenance', workspaceId, dedupeWindowMinutes: 12 * 60 },
      async () => {
        const settings = await getWorkspaceSettings(workspaceId);

        // Order matters: refresh overdue status first so the invoice
        // reminders see the correct state.
        const overdueUpdated = await refreshOverdueInvoices(workspaceId);
        const renewals = await runRenewalReminders(workspaceId);
        const invoiceReminders = await runOverdueInvoiceReminders(
          workspaceId,
          settings.invoiceReminderDays,
        );

        return { overdueUpdated, renewals, invoiceReminders };
      },
    );

    results.push({ workspaceId, status: outcome.status, ...(outcome.error ? { error: outcome.error } : {}), result: outcome.result });
  }

  // Housekeeping that is not workspace-specific.
  const prunedRateLimits = await pruneRateLimits();

  const anyFailed = results.some((r) => r.status === 'failed');
  return NextResponse.json(
    { ok: !anyFailed, ranAt: new Date().toISOString(), prunedRateLimits, results },
    { status: anyFailed ? 500 : 200 },
  );
}

/** Some schedulers only issue POST. */
export async function POST(request: Request) {
  return GET(request);
}
