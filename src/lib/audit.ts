import { headers } from 'next/headers';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { hashIp } from '@/lib/auth/crypto';
import { logger } from '@/lib/logger';

/**
 * Audit trail.
 *
 * Every financial mutation, role change, card/platform association change,
 * export and file access decision is recorded here. Values are redacted
 * before storage: we keep *what changed*, never secrets or file contents.
 */

/** Field names never written to the audit log, whatever the entity. */
const REDACTED_FIELDS = new Set([
  'passwordHash',
  'password',
  'mfaSecretEnc',
  'mfaRecoveryCodes',
  'tokenHash',
  'csrfTokenHash',
  'storageKey',
  'secret',
  'apiKey',
]);

type Jsonish = Record<string, unknown> | null | undefined;

function sanitize(value: Jsonish): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (REDACTED_FIELDS.has(k)) {
      out[k] = '[redacted]';
    } else if (v instanceof Date) {
      out[k] = v.toISOString();
    } else if (typeof v === 'object' && v !== null && 'toFixed' in (v as object)) {
      // Prisma Decimal — store its exact string form, never a float.
      out[k] = String(v);
    } else if (typeof v === 'bigint') {
      out[k] = v.toString();
    } else {
      out[k] = v as unknown;
    }
  }
  return out as Prisma.InputJsonValue;
}

export interface AuditInput {
  workspaceId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  before?: Jsonish;
  after?: Jsonish;
}

/**
 * Write an audit record. Accepts an optional transaction client so the audit
 * entry commits atomically with the change it describes.
 */
export async function recordAudit(
  input: AuditInput,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;

  let ipHash: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    ipHash = hashIp(forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip'));
    userAgent = h.get('user-agent')?.slice(0, 500) ?? null;
  } catch {
    // Outside a request scope (cron, seed, CLI) — no client fingerprint.
  }

  try {
    await client.auditLog.create({
      data: {
        workspaceId: input.workspaceId,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary ?? null,
        beforeJson: sanitize(input.before),
        afterJson: sanitize(input.after),
        ipHash,
        userAgent,
      },
    });
  } catch (error) {
    // An audit failure must never silently swallow the business operation,
    // but it also must not mask the original error. Log loudly instead.
    logger.error('Failed to write audit log', { action: input.action, error });
    if (tx) throw error; // inside a transaction, fail the whole unit of work
  }
}

/** Human-readable labels for the activity feed. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in attempt',
  'auth.logout': 'Signed out',
  'auth.mfa_enrolled': 'Enabled two-factor authentication',
  'auth.mfa_disabled': 'Disabled two-factor authentication',
  'auth.password_changed': 'Changed password',
  'team.invited': 'Invited a team member',
  'team.role_changed': 'Changed a team member role',
  'team.removed': 'Removed a team member',
  'client.created': 'Created client',
  'client.updated': 'Updated client',
  'client.archived': 'Archived client',
  'client.restored': 'Restored client',
  'client.deleted': 'Deleted client',
  'client.imported': 'Imported clients',
  'client.exported': 'Exported clients',
  'project.created': 'Created project',
  'project.updated': 'Updated project',
  'project.deleted': 'Deleted project',
  'project.member_added': 'Added project member',
  'project.member_removed': 'Removed project member',
  'task.created': 'Created task',
  'task.updated': 'Updated task',
  'task.deleted': 'Deleted task',
  'task.commented': 'Commented on task',
  'invoice.created': 'Created invoice',
  'invoice.updated': 'Updated invoice',
  'invoice.issued': 'Issued invoice',
  'invoice.sent': 'Sent invoice',
  'invoice.voided': 'Voided invoice',
  'invoice.cancelled': 'Cancelled invoice',
  'invoice.deleted': 'Deleted draft invoice',
  'invoice.pdf_downloaded': 'Downloaded invoice PDF',
  'payment.created': 'Recorded payment',
  'payment.updated': 'Updated payment',
  'payment.deleted': 'Deleted payment',
  'creditnote.created': 'Issued credit note',
  'card.created': 'Added payment card',
  'card.updated': 'Updated payment card',
  'card.deleted': 'Deleted payment card',
  'platform.created': 'Added platform',
  'platform.updated': 'Updated platform',
  'platform.deleted': 'Deleted platform',
  'platformlink.created': 'Linked card to platform',
  'platformlink.updated': 'Updated card-platform link',
  'platformlink.removed': 'Marked card removed from platform',
  'platformlink.verified': 'Verified card-platform link',
  'subscription.created': 'Created subscription',
  'subscription.updated': 'Updated subscription',
  'subscription.deleted': 'Deleted subscription',
  'expense.created': 'Recorded expense',
  'expense.updated': 'Updated expense',
  'expense.deleted': 'Deleted expense',
  'file.uploaded': 'Uploaded file',
  'file.downloaded': 'Downloaded file',
  'file.updated': 'Updated file',
  'file.deleted': 'Deleted file',
  'file.imported': 'Imported spreadsheet data',
  'report.exported': 'Exported report',
  'exchangerate.created': 'Added exchange rate',
  'exchangerate.deleted': 'Deleted exchange rate',
  'settings.updated': 'Updated workspace settings',
  'job.executed': 'Scheduled job ran',
};

export function auditLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
