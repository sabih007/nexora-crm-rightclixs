import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import type { Role } from '@/generated/prisma/enums';
import { prisma } from '@/lib/db';
import { isProduction } from '@/lib/env';
import { generateToken, hashIp, sha256 } from './crypto';

/**
 * Opaque, database-backed sessions.
 *
 * The cookie carries a random token; only its SHA-256 digest is stored, so a
 * database leak does not yield usable sessions. Every request revalidates
 * against the row, which means a revoked session or a suspended user takes
 * effect immediately — the property a stateless JWT cannot provide.
 */

export const SESSION_COOKIE = '__Host-nexora_session';
export const CSRF_COOKIE = '__Host-nexora_csrf';

// Fall back to non-__Host- names in development, where cookies are sent over
// plain HTTP and the __Host- prefix requires Secure.
export const sessionCookieName = isProduction ? SESSION_COOKIE : 'nexora_session';
export const csrfCookieName = isProduction ? CSRF_COOKIE : 'nexora_csrf';

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const SESSION_REFRESH_THRESHOLD_MS = 1000 * 60 * 30; // extend if <30min used

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  themePref: string;
  timezone: string | null;
  mfaEnabled: boolean;
  emailOptOut: boolean;
}

export interface AuthContext {
  sessionId: string;
  user: SessionUser;
  workspaceId: string;
  role: Role;
  /** True once the TOTP challenge has been satisfied for this session. */
  mfaSatisfied: boolean;
  csrfToken: string;
}

async function clientFingerprint() {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
  return { ipHash: hashIp(ip), userAgent: h.get('user-agent')?.slice(0, 500) ?? null };
}

/**
 * Create a session row and set the cookies.
 * Returns the raw CSRF token so it can be embedded in forms.
 */
export async function createSession(
  userId: string,
  options: { mfaSatisfied: boolean },
): Promise<{ token: string; csrfToken: string }> {
  const token = generateToken(32);
  const csrfToken = generateToken(24);
  const { ipHash, userAgent } = await clientFingerprint();

  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      csrfTokenHash: sha256(csrfToken),
      ipHash,
      userAgent,
      mfaSatisfiedAt: options.mfaSatisfied ? new Date() : null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  const store = await cookies();
  const base = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
  store.set(sessionCookieName, token, base);
  // The CSRF cookie is deliberately readable by scripts: the double-submit
  // pattern requires the client to echo it back in a header or form field.
  store.set(csrfCookieName, csrfToken, { ...base, httpOnly: false });

  return { token, csrfToken };
}

/** Mark the current session as having passed its MFA challenge. */
export async function markSessionMfaSatisfied(sessionId: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { mfaSatisfiedAt: new Date() },
  });
}

export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(sessionCookieName)?.value;
  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  store.delete(sessionCookieName);
  store.delete(csrfCookieName);
}

export async function revokeAllUserSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

/**
 * Resolve the current request's auth context, or null when unauthenticated.
 * Memoised per request via React `cache` so repeated calls in a render tree
 * hit the database once.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const store = await cookies();
  const token = store.get(sessionCookieName)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: {
        include: {
          memberships: { take: 1, orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  if (session.user.status !== 'ACTIVE') return null;

  const membership = session.user.memberships[0];
  if (!membership) return null;

  // Sliding expiry: extend a session that is actively in use, but only
  // occasionally so we are not writing on every request.
  const remaining = session.expiresAt.getTime() - Date.now();
  if (remaining < SESSION_TTL_MS - SESSION_REFRESH_THRESHOLD_MS) {
    void prisma.session
      .update({
        where: { id: session.id },
        data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS), lastSeenAt: new Date() },
      })
      .catch(() => undefined);
  }

  return {
    sessionId: session.id,
    workspaceId: membership.workspaceId,
    role: membership.role,
    mfaSatisfied: session.mfaSatisfiedAt !== null,
    csrfToken: store.get(csrfCookieName)?.value ?? '',
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      avatarColor: session.user.avatarColor,
      themePref: session.user.themePref,
      timezone: session.user.timezone,
      mfaEnabled: session.user.mfaEnabled,
      emailOptOut: session.user.emailOptOut,
    },
  };
});

/**
 * Validate the double-submit CSRF token for a mutation.
 * Server Actions already carry Next.js' own origin checks; this is defence in
 * depth for route handlers and for any action invoked outside a form post.
 */
export async function assertCsrf(submitted: string | null | undefined): Promise<void> {
  const store = await cookies();
  const cookieValue = store.get(csrfCookieName)?.value;
  if (!cookieValue || !submitted || cookieValue !== submitted) {
    throw new Error('CSRF validation failed');
  }
}
