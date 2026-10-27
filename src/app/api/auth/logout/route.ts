import { NextResponse } from 'next/server';
import { getAuthContext, destroyCurrentSession } from '@/lib/auth/session';
import { assertStateChangeAllowed, CsrfError } from '@/lib/auth/csrf';
import { recordAudit } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    await assertStateChangeAllowed(request);
  } catch (error) {
    if (error instanceof CsrfError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

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
