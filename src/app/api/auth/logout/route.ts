import { NextResponse } from 'next/server';
import { getAuthContext, destroyCurrentSession } from '@/lib/auth/session';
import { recordAudit } from '@/lib/audit';

export async function POST() {
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
  return NextResponse.json({ ok: true });
}
