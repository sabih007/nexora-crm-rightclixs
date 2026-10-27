import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import type { AuthContext } from '@/lib/auth/session';
import { clientScopeWhere } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { escapeLike, type PaginatedResult, skipTake, type Pagination } from '@/lib/query';
import { normalizeName } from '@/lib/utils';
import type { ClientFilters, ClientSortKey } from './schemas';

/**
 * Client read models.
 *
 * Every query starts from `clientScopeWhere(ctx)` so a scoped role can only
 * ever see clients attached to a project they belong to. Sensitive contact
 * fields are blanked for roles without `client:read_sensitive` rather than
 * being fetched and discarded in the UI.
 */

export interface ClientListRow {
  id: string;
  name: string;
  type: 'COMPANY' | 'INDIVIDUAL';
  email: string | null;
  phone: string | null;
  billingCurrency: string;
  status: string;
  tags: string[];
  archivedAt: Date | null;
  createdAt: Date;
  projectCount: number;
  openInvoiceCount: number;
}

function buildWhere(ctx: AuthContext, filters: ClientFilters): Prisma.ClientWhereInput {
  const where: Prisma.ClientWhereInput = { ...clientScopeWhere(ctx) };
  const and: Prisma.ClientWhereInput[] = [];

  if (!filters.includeArchived) and.push({ archivedAt: null });

  if (filters.search) {
    const term = escapeLike(filters.search);
    and.push({
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term, mode: 'insensitive' } },
        { taxId: { contains: term, mode: 'insensitive' } },
        { contacts: { some: { name: { contains: term, mode: 'insensitive' } } } },
      ],
    });
  }

  if (filters.status.length > 0) and.push({ status: { in: filters.status } });
  if (filters.type.length > 0) and.push({ type: { in: filters.type } });
  if (filters.currency) and.push({ billingCurrency: filters.currency });
  if (filters.tag) and.push({ tags: { has: filters.tag } });

  if (and.length > 0) where.AND = and;
  return where;
}

const SORT_FIELDS: Record<ClientSortKey, keyof Prisma.ClientOrderByWithRelationInput> = {
  name: 'name',
  createdAt: 'createdAt',
  status: 'status',
  billingCurrency: 'billingCurrency',
};

export async function listClients(
  ctx: AuthContext,
  filters: ClientFilters,
  pagination: Pagination,
  sort: { key: ClientSortKey; direction: 'asc' | 'desc' },
): Promise<PaginatedResult<ClientListRow>> {
  const where = buildWhere(ctx, filters);
  const canSeeSensitive = roleHasPermission(ctx.role, 'client:read_sensitive');

  const [rows, total] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy: { [SORT_FIELDS[sort.key]]: sort.direction },
      ...skipTake(pagination),
      select: {
        id: true,
        name: true,
        type: true,
        email: true,
        phone: true,
        billingCurrency: true,
        status: true,
        tags: true,
        archivedAt: true,
        createdAt: true,
        _count: { select: { projects: true } },
        invoices: {
          where: { status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } },
          select: { id: true },
        },
      },
    }),
    prisma.client.count({ where }),
  ]);

  return {
    rows: rows.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      email: canSeeSensitive ? c.email : null,
      phone: canSeeSensitive ? c.phone : null,
      billingCurrency: c.billingCurrency,
      status: c.status,
      tags: c.tags,
      archivedAt: c.archivedAt,
      createdAt: c.createdAt,
      projectCount: c._count.projects,
      openInvoiceCount: c.invoices.length,
    })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

/** Every distinct tag in scope, for the filter dropdown. */
export async function listClientTags(ctx: AuthContext): Promise<string[]> {
  const rows = await prisma.client.findMany({
    where: { ...clientScopeWhere(ctx), archivedAt: null },
    select: { tags: true },
  });
  return [...new Set(rows.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b));
}

/** Lightweight options list for selects. */
export async function listClientOptions(ctx: AuthContext) {
  return prisma.client.findMany({
    where: { ...clientScopeWhere(ctx), archivedAt: null },
    select: { id: true, name: true, billingCurrency: true },
    orderBy: { name: 'asc' },
    take: 500,
  });
}

export async function getClientDetail(ctx: AuthContext, clientId: string) {
  const canSeeSensitive = roleHasPermission(ctx.role, 'client:read_sensitive');

  const client = await prisma.client.findFirst({
    where: { id: clientId, ...clientScopeWhere(ctx) },
    include: {
      contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
      projects: {
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          status: true,
          priority: true,
          dueDate: true,
          budgetAmount: true,
          currency: true,
          _count: { select: { tasks: true } },
        },
      },
    },
  });

  if (!client) return null;

  return {
    ...client,
    email: canSeeSensitive ? client.email : null,
    phone: canSeeSensitive ? client.phone : null,
    taxId: canSeeSensitive ? client.taxId : null,
    notes: canSeeSensitive ? client.notes : null,
    contacts: canSeeSensitive
      ? client.contacts
      : client.contacts.map((c) => ({ ...c, email: null, phone: null })),
    canSeeSensitive,
  };
}

/**
 * Duplicate detection.
 *
 * Matches on the normalised name (case, accents, punctuation and common legal
 * suffixes removed) or an exact email match. Warn-only: the user decides.
 */
export async function findPotentialDuplicates(
  ctx: AuthContext,
  input: { name: string; email?: string | null },
  excludeId?: string,
): Promise<{ id: string; name: string; email: string | null; status: string }[]> {
  const normalized = normalizeName(input.name);
  const or: Prisma.ClientWhereInput[] = [];
  if (normalized) or.push({ normalizedName: normalized });
  if (input.email) or.push({ email: input.email.toLowerCase() });
  if (or.length === 0) return [];

  return prisma.client.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      archivedAt: null,
      OR: or,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true, name: true, email: true, status: true },
    take: 5,
  });
}

/** Financial summary for a client, in that client's billing currency. */
export async function getClientFinancials(ctx: AuthContext, clientId: string) {
  if (!roleHasPermission(ctx.role, 'invoice:read')) return null;

  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: { clientId, workspaceId: ctx.workspaceId, status: { notIn: ['VOID', 'CANCELLED'] } },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        currency: true,
        issueDate: true,
        dueDate: true,
        grandTotal: true,
        amountPaid: true,
      },
      orderBy: { issueDate: 'desc' },
    }),
    prisma.payment.findMany({
      where: { clientId, workspaceId: ctx.workspaceId },
      select: {
        id: true,
        amount: true,
        currency: true,
        paymentDate: true,
        method: true,
        reference: true,
      },
      orderBy: { paymentDate: 'desc' },
      take: 25,
    }),
  ]);

  return { invoices, payments };
}

/** Recent audit entries for this client, used by the activity timeline. */
export async function getClientActivity(ctx: AuthContext, clientId: string, take = 30) {
  const projectIds = await prisma.project.findMany({
    where: { clientId, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  const invoiceIds = await prisma.invoice.findMany({
    where: { clientId, workspaceId: ctx.workspaceId },
    select: { id: true },
  });

  const relatedIds = [clientId, ...projectIds.map((p) => p.id), ...invoiceIds.map((i) => i.id)];

  return prisma.auditLog.findMany({
    where: { workspaceId: ctx.workspaceId, entityId: { in: relatedIds } },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      summary: true,
      createdAt: true,
      actor: { select: { id: true, name: true, avatarColor: true } },
    },
  });
}
