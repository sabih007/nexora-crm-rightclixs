import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAuthContext } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const notifications = await prisma.notification.findMany({
    where: { userId: ctx.user.id, workspaceId: ctx.workspaceId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: {
      id: true, type: true, title: true, body: true,
      link: true, readAt: true, createdAt: true,
    },
  });

  return NextResponse.json({ notifications });
}

/** Mark every notification read for the current user. */
export async function POST() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { count } = await prisma.notification.updateMany({
    where: { userId: ctx.user.id, workspaceId: ctx.workspaceId, readAt: null },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ ok: true, updated: count });
}
