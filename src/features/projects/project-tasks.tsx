'use client';

import * as React from 'react';
import { Columns3, List, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/misc';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { KanbanBoard } from './kanban-board';
import { TaskDialog, type TaskDialogTask } from './task-dialog';
import type { TaskCard } from './queries';
import { daysUntil, formatDate } from '@/lib/dates';
import { useStoredPreference } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const TASK_VIEWS = ['board', 'list'] as const;

/**
 * Task area of a project: board or list, plus the shared task dialog.
 * The view choice is per-viewer and remembered in localStorage.
 */
export function ProjectTasks({
  projectId,
  tasks,
  members,
  canEdit,
  canCreate,
  canDelete,
  canComment,
  taskDetails,
}: {
  projectId: string;
  tasks: TaskCard[];
  members: { id: string; name: string; avatarColor: string }[];
  canEdit: boolean;
  canCreate: boolean;
  canDelete: boolean;
  canComment: boolean;
  /** Full task records including comments, keyed by id. */
  taskDetails: Record<string, TaskDialogTask>;
}) {
  const [view, changeView] = useStoredPreference('nexora-task-view', TASK_VIEWS, 'board');
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [activeTaskId, setActiveTaskId] = React.useState<string | null>(null);
  const [createStatus, setCreateStatus] = React.useState('TODO');

  function openTask(taskId: string) {
    setActiveTaskId(taskId);
    setDialogOpen(true);
  }

  function openCreate(status: string) {
    setActiveTaskId(null);
    setCreateStatus(status);
    setDialogOpen(true);
  }

  const activeTask = activeTaskId ? (taskDetails[activeTaskId] ?? null) : null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div
          className="inline-flex rounded-lg border border-line bg-surface p-0.5"
          role="group"
          aria-label="Task view"
        >
          {(
            [
              { value: 'board', label: 'Board', icon: Columns3 },
              { value: 'list', label: 'List', icon: List },
            ] as const
          ).map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => changeView(opt.value)}
                aria-pressed={view === opt.value}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors',
                  view === opt.value
                    ? 'bg-surface-sunken text-ink'
                    : 'text-ink-subtle hover:text-ink',
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {opt.label}
              </button>
            );
          })}
        </div>

        {canCreate ? (
          <Button size="sm" onClick={() => openCreate('TODO')}>
            <Plus /> New task
          </Button>
        ) : null}
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          description="Break the project into tasks to track progress on the board."
          action={
            canCreate ? (
              <Button onClick={() => openCreate('TODO')}>
                <Plus /> Add the first task
              </Button>
            ) : null
          }
        />
      ) : view === 'board' ? (
        <KanbanBoard
          tasks={tasks}
          canEdit={canEdit}
          onOpenTask={openTask}
          onCreateTask={openCreate}
        />
      ) : (
        <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-line bg-surface">
          {tasks.map((task) => {
            const overdue = task.dueDate && task.status !== 'DONE' && daysUntil(task.dueDate) < 0;
            return (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => openTask(task.id)}
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40"
                >
                  <StatusBadge kind="task" value={task.status} />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{task.title}</span>
                  <StatusBadge kind="priority" value={task.priority} size="sm" />
                  {task.dueDate ? (
                    <span
                      className={cn(
                        'whitespace-nowrap text-xs',
                        overdue ? 'font-medium text-danger' : 'text-ink-subtle',
                      )}
                    >
                      {formatDate(task.dueDate)}
                    </span>
                  ) : null}
                  {task.assignee ? (
                    <Avatar
                      name={task.assignee.name}
                      color={task.assignee.avatarColor}
                      size="xs"
                    />
                  ) : (
                    <span className="size-5" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={projectId}
        task={activeTask}
        defaultStatus={createStatus}
        members={members}
        canEdit={canEdit}
        canDelete={canDelete}
        canComment={canComment}
      />
    </div>
  );
}
