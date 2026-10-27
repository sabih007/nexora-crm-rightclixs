import 'server-only';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { csrfCookieName } from './session';

/**
 * Cross-site request forgery protection for route handlers.
 *
 * Next.js verifies the Origin against the Host for Server Actions, so those
 * are already covered. Plain route handlers are not, so any handler that
 * changes state calls `assertStateChangeAllowed` below.
 *
 * Two independent checks, both cheap:
 *
 *  1. **Origin** — a cross-site form post cannot set `Origin` to our host,
 *     and `fetch` from another origin cannot forge it either.
 *  2. **Double-submit token** — the session issues a CSRF token in a
 *     script-readable cookie; the client echoes it in `x-csrf-token`. A
 *     cross-site attacker can cause the cookie to be *sent* but cannot read
 *     it, so it cannot populate the header.
 *
 * A request must satisfy the origin check. The token is additionally
 * required when the client supplied a CSRF cookie, which every signed-in
 * browser session does.
 */

export class CsrfError extends Error {
  readonly code = 'CSRF';
  constructor(message = 'This request could not be verified. Reload the page and try again.') {
    super(message);
    this.name = 'CsrfError';
  }
}

/** The origins this deployment considers its own. */
function allowedOrigins(request: Request): Set<string> {
  const origins = new Set<string>([env.APP_URL]);

  // Behind a proxy the configured APP_URL may not match the host the
  // browser actually used; trust the forwarded host the platform sets.
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https';
  if (forwardedHost) origins.add(`${forwardedProto}://${forwardedHost}`);

  const host = request.headers.get('host');
  if (host) {
    origins.add(`https://${host}`);
    // Development serves over plain HTTP.
    if (env.NODE_ENV !== 'production') origins.add(`http://${host}`);
  }

  return origins;
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');

  // No Origin header at all: not a browser-initiated cross-site request
  // (same-origin GETs and server-to-server calls omit it). The token check
  // below still applies to anything carrying a session.
  if (!origin) return true;

  const allowed = allowedOrigins(request);
  for (const candidate of allowed) {
    try {
      if (new URL(candidate).origin === new URL(origin).origin) return true;
    } catch {
      // A malformed configured origin should not crash the check.
    }
  }
  return false;
}

/**
 * Guard a state-changing route handler.
 * Throws `CsrfError`, which the caller turns into a 403.
 */
export async function assertStateChangeAllowed(request: Request): Promise<void> {
  if (!isSameOrigin(request)) {
    logger.warn('Blocked a cross-origin state change', {
      origin: request.headers.get('origin'),
      path: new URL(request.url).pathname,
    });
    throw new CsrfError();
  }

  const store = await cookies();
  const cookieToken = store.get(csrfCookieName)?.value;

  // Only enforce the token when the session actually issued one, so a
  // legitimate non-browser caller with a bearer secret is unaffected.
  if (!cookieToken) return;

  const headerToken = request.headers.get('x-csrf-token');
  if (!headerToken || headerToken !== cookieToken) {
    logger.warn('Blocked a request with a missing or mismatched CSRF token', {
      path: new URL(request.url).pathname,
    });
    throw new CsrfError();
  }
}

/** Header name the client must echo the CSRF cookie in. */
export const CSRF_HEADER = 'x-csrf-token';
