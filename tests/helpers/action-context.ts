import { vi } from 'vitest';
import type { Role } from '@/generated/prisma/enums';
import type { AuthContext } from '@/lib/auth/session';

// ---------------------------------------------------------------------------
// Module mocks
//
// These must sit at the top level: Vitest hoists `vi.mock` above every import,
// so a call nested in a function would run earlier than it reads. Importing
// this helper from a test file is what installs them.
//
// The permission check itself is deliberately NOT stubbed — `requireAuth` and
// `requirePermission` still consult the real matrix, so a test can assert a
// role is refused. Only the request-scoped Next APIs are replaced.
// ---------------------------------------------------------------------------

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', async () => {
  const { getTestPrisma } = await import('./db');
  return {
    get prisma() {
      return getTestPrisma();
    },
  };
});

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/session')>();
  const { getActionContext } = await import('./action-context');
  return {
    ...actual,
    getAuthContext: async () => getActionContext(),
  };
});

/**
 * No-op kept so test files can state their intent explicitly:
 *   import { mockActionEnvironment } from '../helpers/action-context';
 *   mockActionEnvironment();
 * The mocks above are installed by the import itself.
 */
export function mockActionEnvironment(): void {
  /* mocks are registered at module load */
}

/**
 * Harness for exercising server actions in integration tests.
 *
 * Server actions depend on request-scoped Next APIs (cookies, headers,
 * revalidatePath) that do not exist in a plain Node test. These mocks supply
 * the minimum surface so the *real* action code — validation, authorization,
 * transactions, audit writes — runs unchanged against the test database.
 *
 * Importantly the permission check itself is NOT stubbed out: `requireAuth`
 * and `requirePermission` still consult the real permission matrix, so a test
 * can assert that a role is refused.
 */

let currentContext: AuthContext | null = null;

export function setActionContext(context: AuthContext | null): void {
  currentContext = context;
}

export function getActionContext(): AuthContext | null {
  return currentContext;
}

export function makeContext(params: {
  workspaceId: string;
  userId: string;
  role: Role;
  name?: string;
  email?: string;
}): AuthContext {
  return {
    sessionId: `session-${params.userId}`,
    workspaceId: params.workspaceId,
    role: params.role,
    mfaSatisfied: true,
    csrfToken: 'test-csrf',
    user: {
      id: params.userId,
      name: params.name ?? 'Test User',
      email: params.email ?? 'test@example.com',
      avatarColor: '#315CFD',
      themePref: 'system',
      timezone: null,
      mfaEnabled: false,
      emailOptOut: false,
    },
  };
}

/** Assert an action succeeded and return its payload. */
export function expectOk<T>(result: { ok: boolean; data?: T; error?: string }): T {
  if (!result.ok) {
    throw new Error(`Expected the action to succeed, but it failed: ${result.error}`);
  }
  return result.data as T;
}
