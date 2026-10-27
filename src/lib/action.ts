import { z } from 'zod';
import type { AuthContext } from '@/lib/auth/session';
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  requireAuth,
  requirePermission,
} from '@/lib/auth/guard';
import type { Permission } from '@/lib/permissions';
import { logger } from '@/lib/logger';

/**
 * Server-action plumbing.
 *
 * `defineAction` gives every mutation the same spine:
 *   authenticate -> authorize -> validate -> run -> normalise errors.
 *
 * Errors never leak internals to the client. Domain failures raised as
 * `ActionError` are shown to the user; anything else becomes a generic
 * message and is logged server-side with full detail.
 */

export class ActionError extends Error {
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(message: string, options?: { code?: string; fieldErrors?: Record<string, string[]> }) {
    super(message);
    this.name = 'ActionError';
    this.code = options?.code ?? 'ACTION_ERROR';
    this.fieldErrors = options?.fieldErrors;
  }
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string[]> };

export function actionOk<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionFail(
  error: string,
  code = 'ACTION_ERROR',
  fieldErrors?: Record<string, string[]>,
): ActionResult<never> {
  return { ok: false, error, code, ...(fieldErrors ? { fieldErrors } : {}) };
}

function normaliseError(error: unknown, actionName: string): ActionResult<never> {
  if (error instanceof ActionError) {
    return actionFail(error.message, error.code, error.fieldErrors);
  }
  if (error instanceof AuthenticationError) {
    return actionFail(error.message, 'UNAUTHENTICATED');
  }
  if (error instanceof AuthorizationError) {
    return actionFail(error.message, 'FORBIDDEN');
  }
  if (error instanceof NotFoundError) {
    return actionFail(error.message, 'NOT_FOUND');
  }
  if (error instanceof z.ZodError) {
    const flat = z.flattenError(error);
    return actionFail('Please correct the highlighted fields.', 'VALIDATION', flat.fieldErrors as Record<string, string[]>);
  }

  // Prisma unique-constraint and foreign-key violations get a readable message
  // without exposing column names or SQL.
  const code = (error as { code?: string })?.code;
  if (code === 'P2002') {
    return actionFail('That value is already in use.', 'CONFLICT');
  }
  if (code === 'P2003') {
    return actionFail('This record is still referenced by other data.', 'CONFLICT');
  }
  if (code === 'P2025') {
    return actionFail('The record no longer exists.', 'NOT_FOUND');
  }

  logger.error(`Action "${actionName}" failed`, { error });
  return actionFail('Something went wrong. Please try again.', 'INTERNAL');
}

interface DefineActionOptions<TSchema extends z.ZodType, TResult> {
  name: string;
  /** Capability required before the handler runs. Omit for authenticated-only. */
  permission?: Permission;
  /** Zod schema for the input. Omit for actions taking no arguments. */
  input?: TSchema;
  handler: (args: { input: z.output<TSchema>; ctx: AuthContext }) => Promise<TResult>;
}

/**
 * Build an authenticated, authorized, validated server action.
 *
 * Usage:
 *   export const createClient = defineAction({
 *     name: 'client.create',
 *     permission: 'client:create',
 *     input: createClientSchema,
 *     handler: async ({ input, ctx }) => { ... },
 *   });
 */
export function defineAction<TSchema extends z.ZodType, TResult>(
  options: DefineActionOptions<TSchema, TResult>,
) {
  return async (rawInput: z.input<TSchema>): Promise<ActionResult<TResult>> => {
    try {
      const ctx = options.permission
        ? await requirePermission(options.permission)
        : await requireAuth();

      const input = (
        options.input ? options.input.parse(rawInput) : (undefined as never)
      ) as z.output<TSchema>;

      const data = await options.handler({ input, ctx });
      return actionOk(data);
    } catch (error) {
      return normaliseError(error, options.name);
    }
  };
}

/** Variant for actions that take no input. */
export function defineVoidAction<TResult>(options: {
  name: string;
  permission?: Permission;
  handler: (args: { ctx: AuthContext }) => Promise<TResult>;
}) {
  return async (): Promise<ActionResult<TResult>> => {
    try {
      const ctx = options.permission
        ? await requirePermission(options.permission)
        : await requireAuth();
      return actionOk(await options.handler({ ctx }));
    } catch (error) {
      return normaliseError(error, options.name);
    }
  };
}

/** Helper for reading a value that must exist, with a domain-safe error. */
export function must<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new ActionError(message, { code: 'NOT_FOUND' });
  }
  return value;
}
