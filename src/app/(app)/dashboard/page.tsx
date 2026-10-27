import { requireAuthPage } from '@/lib/auth/guard';
import { PageHeader } from '@/components/shared/page-header';

export const metadata = { title: 'Overview' };

export default async function DashboardPage() {
  await requireAuthPage();
  return (
    <>
      <PageHeader title="Overview" description="Workspace at a glance." />
      <p className="text-sm text-ink-muted">Dashboard content is built in Phase 6.</p>
    </>
  );
}
