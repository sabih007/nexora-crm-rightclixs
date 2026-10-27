import { prisma } from '@/lib/db';
import { sha256 } from '@/lib/auth/crypto';

/**
 * Persistent fixed-window rate limiter.
 *
 * Backed by the database rather than process memory so the limit holds across
 * restarts and across serverless instances. Buckets are keyed by a hash so an
 * email address or IP never appears in plaintext in the table.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function rateLimit(
  identifier: string,
  options: { limit: number; windowSeconds: number; scope: string },
): Promise<RateLimitResult> {
  const { limit, windowSeconds, scope } = options;
  const bucketKey = `${scope}:${sha256(identifier).slice(0, 40)}`;
  const now = new Date();

  const existing = await prisma.rateLimit.findUnique({ where: { bucketKey } });

  if (!existing || existing.windowEnd <= now) {
    const windowEnd = new Date(now.getTime() + windowSeconds * 1000);
    await prisma.rateLimit.upsert({
      where: { bucketKey },
      create: { bucketKey, count: 1, windowEnd },
      update: { count: 1, windowEnd },
    });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.windowEnd.getTime() - now.getTime()) / 1000)),
    };
  }

  const updated = await prisma.rateLimit.update({
    where: { bucketKey },
    data: { count: { increment: 1 } },
  });

  return { allowed: true, remaining: Math.max(0, limit - updated.count), retryAfterSeconds: 0 };
}

/** Clear a bucket after a successful authentication. */
export async function resetRateLimit(identifier: string, scope: string): Promise<void> {
  const bucketKey = `${scope}:${sha256(identifier).slice(0, 40)}`;
  await prisma.rateLimit.deleteMany({ where: { bucketKey } });
}

/** Housekeeping: drop expired buckets. Called by the maintenance cron. */
export async function pruneRateLimits(): Promise<number> {
  const { count } = await prisma.rateLimit.deleteMany({
    where: { windowEnd: { lt: new Date() } },
  });
  return count;
}

export const RATE_LIMITS = {
  login: { limit: 8, windowSeconds: 15 * 60, scope: 'login' },
  loginIp: { limit: 30, windowSeconds: 15 * 60, scope: 'login-ip' },
  mfa: { limit: 10, windowSeconds: 10 * 60, scope: 'mfa' },
  passwordChange: { limit: 5, windowSeconds: 60 * 60, scope: 'password-change' },
  upload: { limit: 60, windowSeconds: 60 * 60, scope: 'upload' },
  export: { limit: 30, windowSeconds: 60 * 60, scope: 'export' },
} as const;
