import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CalendarDays, FileText, Pencil, Receipt, Wallet } from 'lucide-react';
import { requireAuthPage, can } from '@/lib/auth/guard';
import { roleHasPermission } from '@/lib/permissions';
import { NoAccessState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { Avatar, Progress } from '@/components/ui/misc';
import { StatusBadge } from '@/components/shared/status-badge';
import { CurrencyAmount } from '@/components/shared/currency-amount';
import { ActivityTimeline } from '@/components/shared/activity-timeline';
import { ProjectTasks } from '@/features/projects/project-tasks';
import type { TaskDialogTask } from '@/features/projects/task-dialog';
import {
  getProjectActivity,
  getProjectDetail,
  listWorkspaceMembers,
  toTaskCard,
} from '@/features/projects/queries';
import { prisma } from '@/lib/db';
import { formatDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAuthPage();
  const project = await getProjectDetail(ctx, id);
  return { title: project?.name ?? 'Project' };
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAuthPage();

  if (!roleHasPermission(ctx.role, 'project:read')) {
    return (
      <>
        <PageHeader title="Project" />
        <NoAccessState what="projects" />
      </>
    );
  }

  const project = await getProjectDetail(ctx, id);
  if (!project) notFound();

  const [activity, members, comments] = await Promise.all([
    getProjectActivity(ctx, id),
    listWorkspaceMembers(ctx),
    prisma.taskComment.findMany({
      where: { task: { projectId: id } },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true, avatarColor: true } } },
    }),
  ]);

  const taskCards = project.tasks.map(toTaskCard);

  const taskDetails: Record<string, TaskDialogTask> = Object.fromEntries(
    project.tasks.map((task) => [
      task.id,
      {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        checklist: Array.isArray(task.checklist)
          ? (task.checklist as { id: string; label: string; done: boolean }[])
          : [],
        assignee: task.assignee,
        comments: comments
          .filter((c) => c.taskId === task.id)
          .map((c) => ({
            id: c.id,
            body: c.body,
            createdAt: c.createdAt,
            author: c.author,
          })),
      } satisfies TaskDialogTask,
    ]),
  );

  const doneCount = taskCards.filter((t) => t.status === 'DONE').length;
  const progress = taskCards.length === 0 ? 0 : (doneCount / taskCards.length) * 100;

  return (
    <>
      <PageHeader
        title={project.name}
        description={project.description ?? undefined}
        breadcrumbs={[
          { label: 'Nexora OS', href: '/dashboard' },
          { label: 'Projects', href: '/projects' },
          { label: project.name },
        ]}
        badge={
          <>
            <StatusBadge kind="project" value={project.status} />
            <StatusBadge kind="priority" value={project.priority} />
            {project.code ? <Badge tone="outline">{project.code}</Badge> : null}
          </>
        }
        actions={
          <>
            {can(ctx, 'project:update') ? (
              <Button variant="secondary" asChild>
                <Link href={`/projects/${project.id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
            ) : null}
            {can(ctx, 'invoice:create') && project.clientId ? (
              <Button asChild>
                <Link href={`/invoices/new?clientId=${project.clientId}&projectId=${project.id}`}>
                  <Receipt /> New invoice
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0">
          <Tabs defaultValue="tasks">
            <TabsList>
              <TabsTrigger value="tasks">Tasks ({taskCards.length})</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="tasks">
              <ProjectTasks
                projectId={project.id}
                tasks={taskCards}
                members={members.map((m) => ({
                  id: m.id,
                  name: m.name,
                  avatarColor: m.avatarColor,
                }))}
                taskDetails={taskDetails}
                canEdit={can(ctx, 'task:update')}
                canCreate={can(ctx, 'task:create')}
                canDelete={can(ctx, 'task:delete')}
                canComment={can(ctx, 'task:comment')}
              />
            </TabsContent>

            <TabsContent value="activity">
              <Card>
                <CardContent className="pt-5">
                  <ActivityTimeline entries={activity} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="tabular text-ink text-2xl font-semibold">
                    {Math.round(progress)}%
                  </span>
                  <span className="text-ink-subtle tabular text-xs">
                    {doneCount}/{taskCards.length} tasks
                  </span>
                </div>
                <Progress
                  value={progress}
                  tone={progress === 100 ? 'success' : 'brand'}
                  className="mt-2"
                  label="Project completion"
                />
                <p className="text-ink-subtle mt-1.5 text-[11px]">
                  Completion counts tasks marked Done out of all tasks.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {project.client ? (
                <div>
                  <p className="text-ink-subtle text-xs">Client</p>
                  <Link
                    href={`/clients/${project.client.id}`}
                    className="text-brand-500 font-medium hover:underline"
                  >
                    {project.client.name}
                  </Link>
                </div>
              ) : (
                <div>
                  <p className="text-ink-subtle text-xs">Client</p>
                  <p className="text-ink-muted">Internal project</p>
                </div>
              )}

              {project.budgetAmount ? (
                <div>
                  <p className="text-ink-subtle text-xs">Budget</p>
                  <CurrencyAmount
                    amount={project.budgetAmount.toString()}
                    currency={project.currency}
                    className="font-medium"
                  />
                </div>
              ) : null}

              <div className="flex gap-6">
                <div>
                  <p className="text-ink-subtle text-xs">Start</p>
                  <p className="text-ink">{formatDate(project.startDate)}</p>
                </div>
                <div>
                  <p className="text-ink-subtle text-xs">Due</p>
                  <p className="text-ink inline-flex items-center gap-1">
                    <CalendarDays className="text-ink-subtle size-3.5" aria-hidden />
                    {formatDate(project.dueDate)}
                  </p>
                </div>
              </div>

              <div className="border-line text-ink-subtle flex flex-wrap gap-4 border-t pt-3 text-xs">
                <span className="inline-flex items-center gap-1">
                  <Receipt className="size-3.5" aria-hidden /> {project._count.invoices} invoices
                </span>
                <span className="inline-flex items-center gap-1">
                  <Wallet className="size-3.5" aria-hidden /> {project._count.expenses} expenses
                </span>
                <span className="inline-flex items-center gap-1">
                  <FileText className="size-3.5" aria-hidden /> {project._count.files} files
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Team</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {project.owner ? (
                <div className="flex items-center gap-2.5">
                  <Avatar name={project.owner.name} color={project.owner.avatarColor} size="sm" />
                  <div className="min-w-0">
                    <p className="text-ink truncate text-[13px] font-medium">
                      {project.owner.name}
                    </p>
                    <p className="text-ink-subtle text-[11px]">Owner</p>
                  </div>
                </div>
              ) : null}
              {project.members
                .filter((m) => m.user.id !== project.ownerId)
                .map((member) => (
                  <div key={member.id} className="flex items-center gap-2.5">
                    <Avatar name={member.user.name} color={member.user.avatarColor} size="sm" />
                    <div className="min-w-0">
                      <p className="text-ink truncate text-[13px]">{member.user.name}</p>
                      <p className="text-ink-subtle text-[11px] capitalize">{member.role}</p>
                    </div>
                  </div>
                ))}
              {project.members.length === 0 && !project.owner ? (
                <p className="text-ink-subtle text-sm">No one assigned.</p>
              ) : null}
            </CardContent>
          </Card>

          {project.tags.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Tags</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {project.tags.map((tag) => (
                  <Badge key={tag} tone="outline">
                    {tag}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}
