'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, rateLimit, resetRateLimit } from '@/lib/rate-limit';
import { roleRequiresMfa } from '@/lib/permissions';
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from '@/lib/auth/crypto';
import {
  consumeRecoveryCode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCodes,
  totpQrDataUrl,
  verifyTotp,
} from '@/lib/auth/mfa';
import {
  createSession,
  destroyCurrentSession,
  getAuthContext,
  markSessionMfaSatisfied,
  revokeAllUserSessions,
} from '@/lib/auth/session';
import { requireAuth } from '@/lib/auth/guard';
import { ActionError, type ActionResult, actionFail, actionOk, defineAction } from '@/lib/action';

/**
 * Authentication actions.
 *
 * Login is deliberately uniform: a wrong email and a wrong password produce
 * the same message and comparable timing, so the form cannot be used to
 * enumerate accounts.
 */

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MINUTES = 15;

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  password: z.string().min(1, 'Enter your password.'),
});

const GENERIC_LOGIN_ERROR = 'Those credentials do not match an active account.';

async function requestIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
}

export type LoginOutcome = { status: 'authenticated' } | { status: 'mfa_required' };

export async function login(raw: unknown): Promise<ActionResult<LoginOutcome>> {
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return actionFail('Please correct the highlighted fields.', 'VALIDATION', {
      ...z.flattenError(parsed.error).fieldErrors,
    } as Record<string, string[]>);
  }
  const { email, password } = parsed.data;

  const ip = await requestIp();
  const ipLimit = await rateLimit(ip, RATE_LIMITS.loginIp);
  if (!ipLimit.allowed) {
    return actionFail('Too many attempts from this network. Try again later.', 'RATE_LIMITED');
  }
  const emailLimit = await rateLimit(email, RATE_LIMITS.login);
  if (!emailLimit.allowed) {
    return actionFail(
      `Too many sign-in attempts. Try again in ${Math.ceil(emailLimit.retryAfterSeconds / 60)} minutes.`,
      'RATE_LIMITED',
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: { take: 1, orderBy: { createdAt: 'asc' } } },
  });

  // Always run a verification so a missing account and a wrong password take
  // comparable time. The dummy hash is a real argon2id digest.
  const DUMMY_HASH =
    '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$Qk9KBPZ5zX0u3lCjvH0yC0cJ7V9mJmZ5Y1lZ8e6Qd0A';
  const passwordOk = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, password);

  if (!user || !user.passwordHash || !passwordOk) {
    if (user) {
      const failures = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failures,
          lockedUntil:
            failures >= MAX_FAILED_ATTEMPTS
              ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
              : user.lockedUntil,
        },
      });
      const membership = user.memberships[0];
      if (membership) {
        await recordAudit({
          workspaceId: membership.workspaceId,
          actorId: user.id,
          action: 'auth.login_failed',
          entityType: 'User',
          entityId: user.id,
          summary: 'Incorrect password',
        });
      }
    }
    logger.warn('Failed login attempt', { email });
    return actionFail(GENERIC_LOGIN_ERROR, 'INVALID_CREDENTIALS');
  }

  if (user.status !== 'ACTIVE') {
    return actionFail(GENERIC_LOGIN_ERROR, 'INVALID_CREDENTIALS');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return actionFail(
      'This account is temporarily locked after repeated failed attempts.',
      'LOCKED',
    );
  }

  const membership = user.memberships[0];
  if (!membership) {
    return actionFail('Your account is not attached to a workspace yet.', 'NO_WORKSPACE');
  }

  const needsMfa = roleRequiresMfa(membership.role) && user.mfaEnabled;

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  // A successful sign-in clears both buckets: the account is evidently not
  // under attack, and the shared office address should not accumulate a
  // lockout from ordinary daily use.
  await resetRateLimit(email, RATE_LIMITS.login.scope);
  await resetRateLimit(ip, RATE_LIMITS.loginIp.scope);

  await createSession(user.id, { mfaSatisfied: !needsMfa });

  await recordAudit({
    workspaceId: membership.workspaceId,
    actorId: user.id,
    action: 'auth.login',
    entityType: 'User',
    entityId: user.id,
    summary: needsMfa ? 'Password accepted, awaiting two-factor' : 'Signed in',
  });

  return actionOk(needsMfa ? { status: 'mfa_required' } : { status: 'authenticated' });
}

const verifySchema = z.object({
  code: z.string().trim().min(6, 'Enter the 6-digit code.'),
  /** True when the user is redeeming a recovery code instead of a TOTP. */
  useRecoveryCode: z.boolean().default(false),
});

export async function verifyMfa(raw: unknown): Promise<ActionResult<{ status: 'authenticated' }>> {
  const ctx = await getAuthContext();
  if (!ctx) return actionFail('Your session expired. Sign in again.', 'UNAUTHENTICATED');
  if (ctx.mfaSatisfied) return actionOk({ status: 'authenticated' });

  const parsed = verifySchema.safeParse(raw);
  if (!parsed.success)
    return actionFail('Enter the 6-digit code from your authenticator app.', 'VALIDATION');

  const limit = await rateLimit(ctx.user.id, RATE_LIMITS.mfa);
  if (!limit.allowed) {
    return actionFail('Too many attempts. Try again shortly.', 'RATE_LIMITED');
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: ctx.user.id },
    select: { id: true, email: true, mfaSecretEnc: true, mfaRecoveryCodes: true },
  });
  if (!user.mfaSecretEnc)
    return actionFail('Two-factor is not configured for this account.', 'NO_MFA');

  if (parsed.data.useRecoveryCode) {
    const hashes = (user.mfaRecoveryCodes as string[] | null) ?? [];
    const remaining = await consumeRecoveryCode(hashes, parsed.data.code);
    if (!remaining) return actionFail('That recovery code is not valid.', 'INVALID_CODE');
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaRecoveryCodes: remaining },
    });
  } else {
    const secret = decryptSecret(user.mfaSecretEnc);
    if (!verifyTotp(secret, parsed.data.code, user.email)) {
      return actionFail('That code is not valid. Check your authenticator app.', 'INVALID_CODE');
    }
  }

  await markSessionMfaSatisfied(ctx.sessionId);
  await resetRateLimit(ctx.user.id, RATE_LIMITS.mfa.scope);
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorId: ctx.user.id,
    action: 'auth.login',
    entityType: 'User',
    entityId: ctx.user.id,
    summary: 'Two-factor verified',
  });

  return actionOk({ status: 'authenticated' });
}

export async function logout(): Promise<void> {
  const ctx = await getAuthContext();
  if (ctx) {
    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'auth.logout',
      entityType: 'User',
      entityId: ctx.user.id,
    });
  }
  await destroyCurrentSession();
  redirect('/login');
}

// ---------------------------------------------------------------------------
// MFA enrolment (from the profile page)
// ---------------------------------------------------------------------------

export async function beginMfaEnrolment(): Promise<
  ActionResult<{ secret: string; qrDataUrl: string }>
> {
  try {
    const ctx = await requireAuth();
    const secret = generateTotpSecret();
    const qrDataUrl = await totpQrDataUrl(secret, ctx.user.email);
    // The secret is not persisted until the user proves they can generate a
    // valid code from it, so an abandoned enrolment leaves nothing behind.
    return actionOk({ secret, qrDataUrl });
  } catch {
    return actionFail('Could not start enrolment.', 'INTERNAL');
  }
}

export const completeMfaEnrolment = defineAction({
  name: 'auth.mfa_enrol',
  input: z.object({
    secret: z.string().min(16),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Enter the 6-digit code.'),
  }),
  handler: async ({ input, ctx }) => {
    if (!verifyTotp(input.secret, input.code, ctx.user.email)) {
      throw new ActionError('That code is not valid. Try the next one your app shows.', {
        code: 'INVALID_CODE',
        fieldErrors: { code: ['Incorrect code.'] },
      });
    }

    const recoveryCodes = generateRecoveryCodes();
    await prisma.user.update({
      where: { id: ctx.user.id },
      data: {
        mfaSecretEnc: encryptSecret(input.secret),
        mfaEnabled: true,
        mfaEnrolledAt: new Date(),
        mfaRecoveryCodes: await hashRecoveryCodes(recoveryCodes),
      },
    });
    await markSessionMfaSatisfied(ctx.sessionId);
    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'auth.mfa_enrolled',
      entityType: 'User',
      entityId: ctx.user.id,
    });

    // Returned once. They are stored only as hashes.
    return { recoveryCodes };
  },
});

export const disableMfa = defineAction({
  name: 'auth.mfa_disable',
  input: z.object({ password: z.string().min(1) }),
  handler: async ({ input, ctx }) => {
    if (roleRequiresMfa(ctx.role)) {
      throw new ActionError(
        'Two-factor authentication is mandatory for your role and cannot be turned off.',
        { code: 'MFA_REQUIRED' },
      );
    }
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.user.id },
      select: { passwordHash: true },
    });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.password))) {
      throw new ActionError('Incorrect password.', {
        fieldErrors: { password: ['Incorrect password.'] },
      });
    }
    await prisma.user.update({
      where: { id: ctx.user.id },
      data: {
        mfaEnabled: false,
        mfaSecretEnc: null,
        mfaRecoveryCodes: Prisma.DbNull,
        mfaEnrolledAt: null,
      },
    });
    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'auth.mfa_disabled',
      entityType: 'User',
      entityId: ctx.user.id,
    });
    return { disabled: true };
  },
});

// ---------------------------------------------------------------------------
// Password change
// ---------------------------------------------------------------------------

export const changePassword = defineAction({
  name: 'auth.change_password',
  input: z
    .object({
      currentPassword: z.string().min(1, 'Enter your current password.'),
      newPassword: z
        .string()
        .min(12, 'Use at least 12 characters.')
        .max(200)
        .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
          message: 'Include upper case, lower case and a number.',
        }),
      confirmPassword: z.string(),
    })
    .refine((v) => v.newPassword === v.confirmPassword, {
      message: 'Passwords do not match.',
      path: ['confirmPassword'],
    }),
  handler: async ({ input, ctx }) => {
    const limit = await rateLimit(ctx.user.id, RATE_LIMITS.passwordChange);
    if (!limit.allowed)
      throw new ActionError('Too many attempts. Try again later.', { code: 'RATE_LIMITED' });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.user.id },
      select: { passwordHash: true },
    });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new ActionError('Your current password is incorrect.', {
        fieldErrors: { currentPassword: ['Incorrect password.'] },
      });
    }

    await prisma.user.update({
      where: { id: ctx.user.id },
      data: { passwordHash: await hashPassword(input.newPassword), passwordChangedAt: new Date() },
    });

    // Changing a password invalidates every other session.
    await revokeAllUserSessions(ctx.user.id, ctx.sessionId);

    await recordAudit({
      workspaceId: ctx.workspaceId,
      actorId: ctx.user.id,
      action: 'auth.password_changed',
      entityType: 'User',
      entityId: ctx.user.id,
      summary: 'Other sessions were signed out',
    });

    return { changed: true };
  },
});
