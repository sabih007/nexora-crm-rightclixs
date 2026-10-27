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

/**
 * Labels live in `audit-labels.ts` so client components can import them
 * without pulling Prisma, `next/headers` and the argon2 binding into the
 * browser bundle. Re-exported here for server-side convenience.
 */
export { AUDIT_ACTION_LABELS, auditLabel } from './audit-labels';
