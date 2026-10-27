import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAuthContext } from '@/lib/auth/session';
import { clientScopeWhere, projectScopeWhere } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * Command-palette search.
 *
 * Applies the same scope rules as the list pages: a Staff user searching
 * "Acme" only matches clients attached to a project they belong to, and
 * never matches invoices at all because the role has no `invoice:read`.
 */
export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const term = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (term.length < 2) return NextResponse.json({ results: [] });

  const contains = { contains: term, mode: 'insensitive' as const };
  const LIMIT = 5;

  const [clients, invoices, projects, subscriptions] = await Promise.all([
    roleHasPermission(ctx.role, 'client:read')
      ? prisma.client.findMany({
          where: {
            ...clientScopeWhere(ctx),
            archivedAt: null,
            OR: [{ name: contains }, { email: contains }],
          },
          select: { id: true, name: true, status: true },
          take: LIMIT,
          orderBy: { name: 'asc' },
        })
      : [],

    roleHasPermission(ctx.role, 'invoice:read')
      ? prisma.invoice.findMany({
          where: {
            workspaceId: ctx.workspaceId,
            OR: [{ invoiceNumber: contains }, { client: { name: contains } }],
          },
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            client: { select: { name: true } },
          },
          take: LIMIT,
          orderBy: { issueDate: 'desc' },
        })
      : [],

    roleHasPermission(ctx.role, 'project:read')
      ? prisma.project.findMany({
          where: { ...projectScopeWhere(ctx), archivedAt: null, name: contains },
          select: { id: true, name: true, status: true },
          take: LIMIT,
          orderBy: { updatedAt: 'desc' },
        })
      : [],

    roleHasPermission(ctx.role, 'subscription:read')
      ? prisma.subscription.findMany({
          where: {
            workspaceId: ctx.workspaceId,
            OR: [{ planName: contains }, { platform: { name: contains } }],
          },
          select: {
            id: true,
            planName: true,
            platform: { select: { name: true } },
          },
          take: LIMIT,
          orderBy: { nextChargeAt: 'asc' },
        })
      : [],
  ]);

  const results = [
    ...clients.map((c) => ({
      type: 'client' as const,
      id: c.id,
      title: c.name,
      subtitle: c.status.toLowerCase(),
      href: `/clients/${c.id}`,
    })),
    ...invoices.map((i) => ({
      type: 'invoice' as const,
      id: i.id,
      title: i.invoiceNumber,
      subtitle: i.client.name,
      href: `/invoices/${i.id}`,
    })),
    ...projects.map((p) => ({
      type: 'project' as const,
      id: p.id,
      title: p.name,
      subtitle: p.status.toLowerCase().replace('_', ' '),
      href: `/projects/${p.id}`,
    })),
    ...subscriptions.map((s) => ({
      type: 'subscription' as const,
      id: s.id,
      title: `${s.platform.name} — ${s.planName}`,
      href: `/subscriptions/${s.id}`,
    })),
  ];

  return NextResponse.json({ results });
}
