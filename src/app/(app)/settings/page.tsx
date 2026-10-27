import Link from 'next/link';
import { ArrowRight, Database, HardDrive, Mail, ShieldCheck } from 'lucide-react';
import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState } from '@/components/ui/empty-state';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getWorkspace, getWorkspaceSettings } from '@/lib/workspace';
import { storageStatus } from '@/lib/storage';
import { emailStatus } from '@/lib/email';
import { getStorageUsage } from '@/features/files/queries';
import { WorkspaceSettingsForm } from '@/features/settings/workspace-form';
import { InvoiceDefaultsForm } from '@/features/settings/invoice-defaults-form';
import { formatBytes } from '@/lib/utils';
import { prisma } from '@/lib/db';

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const ctx = await requireAuthPage();
  if (!roleHasPermission(ctx.role, 'settings:read')) {
    return (
      <>
        <PageHeader title="Settings" />
        <NoAccessState what="settings" />
      </>
    );
  }

  const [workspace, settings, usage, lastJob] = await Promise.all([
    getWorkspace(ctx.workspaceId),
    getWorkspaceSettings(ctx.workspaceId),
    getStorageUsage(ctx),
    prisma.jobExecution.findFirst({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: 'desc' },
      select: { jobKey: true, status: true, executedAt: true, lastError: true },
    }),
  ]);

  const storage = storageStatus();
  const email = emailStatus();
  const canEdit = can(ctx, 'settings:update');
  const canEditWorkspace = can(ctx, 'workspace:update');

  return (
    <>
      <PageHeader
        title="Settings"
        description="Workspace configuration, invoice defaults and integration status."
        breadcrumbs={[{ label: 'Nexora OS', href: '/dashboard' }, { label: 'Settings' }]}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-5">
          <section>
            <SectionHeader
              title="Workspace"
              description="Appears on invoices and sets the base currency for consolidated reports."
            />
            <WorkspaceSettingsForm workspace={workspace} canEdit={canEditWorkspace} />
          </section>

          <section>
            <SectionHeader
              title="Invoice and reminder defaults"
              description="Applied to new invoices and to the daily reminder job."
            />
            <InvoiceDefaultsForm settings={settings} canEdit={canEdit} />
          </section>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Quick links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {[
                { href: '/settings/profile', label: 'Profile & security', show: true },
                {
                  href: '/settings/exchange-rates',
                  label: 'Exchange rates',
                  show: can(ctx, 'exchangerate:read'),
                },
                { href: '/team', label: 'Team & roles', show: can(ctx, 'team:read') },
                { href: '/activity', label: 'Activity log', show: can(ctx, 'audit:read') },
              ]
                .filter((link) => link.show)
                .map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="text-ink-muted hover:bg-surface-hover hover:text-ink flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition-colors"
                  >
                    <span className="flex-1">{link.label}</span>
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Integration status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <StatusRow
                icon={HardDrive}
                label="File storage"
                badge={storage.driver}
                ready={storage.productionReady}
                description={storage.description}
              />
              <StatusRow
                icon={Mail}
                label="Email"
                badge={email.driver}
                ready={email.productionReady}
                description={email.description}
              />
              <StatusRow
                icon={ShieldCheck}
                label="Malware scanning"
                badge="not configured"
                ready={false}
                description="Uploads are checked by extension, declared type and file signature. No antivirus engine is connected."
              />
              <StatusRow
                icon={Database}
                label="Scheduled jobs"
                badge={lastJob?.status.toLowerCase() ?? 'never run'}
                ready={lastJob?.status === 'SUCCEEDED'}
                description={
                  lastJob?.executedAt
                    ? `Last run ${lastJob.executedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC${lastJob.lastError ? ` — ${lastJob.lastError}` : ''}`
                    : 'The daily reminder job has not run yet. Point a scheduler at /api/cron/reminders.'
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Storage used</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-subtle">Active files</span>
                <span className="tabular text-ink">
                  {usage.activeCount} · {formatBytes(usage.activeBytes)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-subtle">Deleted (recoverable)</span>
                <span className="tabular text-ink-muted">
                  {usage.deletedCount} · {formatBytes(usage.deletedBytes)}
                </span>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}

function StatusRow({
  icon: Icon,
  label,
  badge,
  ready,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge: string;
  ready: boolean;
  description: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon className="text-ink-subtle size-3.5 shrink-0" />
        <span className="text-ink text-[13px] font-medium">{label}</span>
        <Badge tone={ready ? 'success' : 'warning'} size="sm" className="ml-auto">
          {badge}
        </Badge>
      </div>
      <p className="text-ink-subtle mt-0.5 pl-5 text-[11px] leading-relaxed">{description}</p>
    </div>
  );
}
