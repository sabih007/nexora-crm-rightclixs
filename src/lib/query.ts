import { z } from 'zod';

/**
 * Shared list-query parsing.
 *
 * List pages read their state from the URL so a filtered view is linkable and
 * survives a refresh. Everything is validated and clamped here — a
 * hand-edited `?pageSize=100000` can never reach the database.
 */

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  pageSize: z.coerce.number().int().min(5).max(MAX_PAGE_SIZE).catch(DEFAULT_PAGE_SIZE),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function parsePagination(params: Record<string, string | string[] | undefined>): Pagination {
  return paginationSchema.parse({
    page: first(params.page) ?? 1,
    pageSize: first(params.pageSize) ?? DEFAULT_PAGE_SIZE,
  });
}

export function skipTake(pagination: Pagination) {
  return { skip: (pagination.page - 1) * pagination.pageSize, take: pagination.pageSize };
}

/**
 * Validate a sort key against an allow-list, so the sort column can never be
 * attacker-chosen. Returns a Prisma `orderBy` object.
 */
export function parseSort<TKey extends string>(
  raw: string | undefined,
  allowed: readonly TKey[],
  fallback: { key: TKey; direction: 'asc' | 'desc' },
): { key: TKey; direction: 'asc' | 'desc' } {
  if (!raw) return fallback;
  const [keyPart, directionPart] = raw.split(':');
  const key = allowed.find((k) => k === keyPart);
  if (!key) return fallback;
  return { key, direction: directionPart === 'desc' ? 'desc' : 'asc' };
}

export function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Read a repeated query param as a validated array of enum values. */
export function parseEnumList<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : value.split(',');
  const set = new Set(allowed);
  return raw.map((v) => v.trim()).filter((v): v is T => set.has(v as T));
}

/**
 * Escape a user-supplied term before it is used in a Prisma `contains`
 * filter. Prisma parameterises the value so there is no SQL injection risk,
 * but `%` and `_` would otherwise act as wildcards in a `LIKE`-backed search.
 */
export function escapeLike(term: string): string {
  return term.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

export interface PaginatedResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}
