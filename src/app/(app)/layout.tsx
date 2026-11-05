import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { requireAuthPage } from '@/lib/auth/guard';
import { getWorkspace } from '@/lib/workspace';
import { AppShell } from '@/components/layout/app-shell';
import { AutoSync } from '@/components/auto-sync';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAuthPage();
  const [workspace, unreadCount, cookieStore] = await Promise.all([
    getWorkspace(ctx.workspaceId),
    prisma.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
    cookies(),
  ]);
  const defaultCollapsed = cookieStore.get('nexora-sidebar')?.value === 'collapsed';

  return (
    <AppShell
      user={{
        id: ctx.user.id,
        name: ctx.user.name,
        email: ctx.user.email,
        avatarColor: ctx.user.avatarColor,
      }}
      role={ctx.role}
      workspaceName={workspace.name}
      baseCurrency={workspace.baseCurrency}
      unreadCount={unreadCount}
      defaultCollapsed={defaultCollapsed}
    >
      {children}
      <AutoSync />
    </AppShell>
  );
}
