import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Scheduled-job plumbing.
 *
 * Cron endpoints are public URLs, so three things matter:
 *  1. Authentication — a shared secret compared in constant time.
 *  2. Replay safety — each run is recorded in `JobExecution`, and a job that
 *     already succeeded for the same key today is not repeated.
 *  3. Observability — every run leaves a row with its status, attempts and
 *     error, so a silent failure is visible rather than invisible.
 */

/**
 * Verify the caller.
 *
 * Accepts `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends) or
 * an `x-cron-secret` header. Comparison is constant-time so the endpoint
 * cannot be used as a timing oracle for the secret.
 */
export function authorizeCronRequest(request: Request): boolean {
  const header =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.headers.get('x-cron-secret') ??
    '';

  const expected = env.CRON_SECRET;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function unauthorizedCronResponse(): NextResponse {
  logger.warn('Rejected an unauthenticated cron request');
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export interface JobRunOptions {
  jobKey: string;
  workspaceId?: string;
  /**
   * When set, a successful run already recorded under the same key within
   * this many minutes short-circuits — the protection against a scheduler
   * delivering the same tick twice.
   */
  dedupeWindowMinutes?: number;
}

export interface JobRunOutcome<T> {
  status: 'succeeded' | 'failed' | 'skipped';
  result?: T;
  error?: string;
  executionId: string;
}

/**
 * Run a job inside a recorded execution.
 * Never throws: a failure is captured, logged and returned, because an
 * unhandled error in a cron handler is an outage nobody notices.
 */
export async function runJob<T>(
  options: JobRunOptions,
  work: () => Promise<T>,
): Promise<JobRunOutcome<T>> {
  const { jobKey, workspaceId, dedupeWindowMinutes = 0 } = options;

  if (dedupeWindowMinutes > 0) {
    const since = new Date(Date.now() - dedupeWindowMinutes * 60_000);
    const recent = await prisma.jobExecution.findFirst({
      where: {
        jobKey,
        ...(workspaceId ? { workspaceId } : {}),
        status: 'SUCCEEDED',
        executedAt: { gte: since },
      },
      select: { id: true },
      orderBy: { executedAt: 'desc' },
    });
    if (recent) {
      logger.info('Job skipped — already ran inside the dedupe window', { jobKey });
      return { status: 'skipped', executionId: recent.id };
    }
  }

  const execution = await prisma.jobExecution.create({
    data: {
      jobKey,
      workspaceId: workspaceId ?? null,
      status: 'RUNNING',
      attempts: 1,
      startedAt: new Date(),
    },
    select: { id: true },
  });

  try {
    const result = await work();
    await prisma.jobExecution.update({
      where: { id: execution.id },
      data: {
        status: 'SUCCEEDED',
        executedAt: new Date(),
        resultJson: JSON.parse(JSON.stringify(result ?? {})),
      },
    });
    logger.info('Job succeeded', { jobKey, executionId: execution.id });
    return { status: 'succeeded', result, executionId: execution.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.jobExecution.update({
      where: { id: execution.id },
      data: { status: 'FAILED', executedAt: new Date(), lastError: message.slice(0, 2000) },
    });
    logger.error('Job failed', { jobKey, executionId: execution.id, error });
    return { status: 'failed', error: message, executionId: execution.id };
  }
}

/** Every workspace, for jobs that run across the installation. */
export async function allWorkspaceIds(): Promise<string[]> {
  const rows = await prisma.workspace.findMany({ select: { id: true } });
  return rows.map((r) => r.id);
}
