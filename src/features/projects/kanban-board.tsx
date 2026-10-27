'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarDays, CheckSquare, GripVertical, MessageSquare, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/misc';
import { StatusBadge } from '@/components/shared/status-badge';
import { TASK_STATUSES } from './schemas';
import type { TaskCard } from './queries';
import { moveTask } from './actions';
import { daysUntil, formatDate } from '@/lib/dates';
import { cn } from '@/lib/utils';

/**
 * Kanban board.
 *
 * Drag-and-drop is optimistic: the card moves immediately and the server call
 * follows. A failure rolls the board back and surfaces a toast, so the UI
 * never silently diverges from the database.
 *
 * Keyboard users get the same capability through dnd-kit's keyboard sensor
 * (Space to lift, arrows to move, Space to drop) plus a per-card status menu.
 */

const COLUMN_LABELS: Record<string, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  BLOCKED: 'Blocked',
  DONE: 'Done',
};

const COLUMN_ORDER = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'] as const;

export function KanbanBoard({
  tasks: initialTasks,
  canEdit,
  onOpenTask,
  onCreateTask,
}: {
  tasks: TaskCard[];
  canEdit: boolean;
  onOpenTask: (taskId: string) => void;
  onCreateTask: (status: string) => void;
}) {
  const router = useRouter();
  const [tasks, setTasks] = React.useState(initialTasks);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  // Keep local state in step when the server sends a fresh list.
  const [syncedFrom, setSyncedFrom] = React.useState(initialTasks);
  if (syncedFrom !== initialTasks) {
    setSyncedFrom(initialTasks);
    setTasks(initialTasks);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byColumn = React.useMemo(() => {
    const map = new Map<string, TaskCard[]>();
    for (const status of COLUMN_ORDER) map.set(status, []);
    for (const task of tasks) {
      const list = map.get(task.status) ?? [];
      list.push(task);
      map.set(task.status, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => Number(a.position) - Number(b.position));
    }
    return map;
  }, [tasks]);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const overId = String(over.id);
    const overTask = tasks.find((t) => t.id === overId);
    const targetStatus = overTask ? overTask.status : overId;
    if (!TASK_STATUSES.includes(targetStatus as (typeof TASK_STATUSES)[number])) return;

    const column = (byColumn.get(targetStatus) ?? []).filter((t) => t.id !== taskId);
    const insertIndex = overTask ? column.findIndex((t) => t.id === overTask.id) : column.length;
    const resolvedIndex = insertIndex === -1 ? column.length : insertIndex;

    const beforeTaskId = resolvedIndex > 0 ? (column[resolvedIndex - 1]?.id ?? null) : null;
    const afterTaskId = column[resolvedIndex]?.id ?? null;

    if (task.status === targetStatus && beforeTaskId === null && afterTaskId === null) return;

    const previous = tasks;
    setTasks((current) =>
      current.map((t) => (t.id === taskId ? { ...t, status: targetStatus } : t)),
    );

    const result = await moveTask({
      id: taskId,
      status: targetStatus as never,
      beforeTaskId,
      afterTaskId,
    });
    if (!result.ok) {
      setTasks(previous);
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
        {COLUMN_ORDER.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            label={COLUMN_LABELS[status] ?? status}
            tasks={byColumn.get(status) ?? []}
            canEdit={canEdit}
            onOpenTask={onOpenTask}
            onCreateTask={onCreateTask}
          />
        ))}
      </div>

      <DragOverlay>{activeTask ? <TaskCardView task={activeTask} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({
  status,
  label,
  tasks,
  canEdit,
  onOpenTask,
  onCreateTask,
}: {
  status: string;
  label: string;
  tasks: TaskCard[];
  canEdit: boolean;
  onOpenTask: (taskId: string) => void;
  onCreateTask: (status: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section
      className={cn(
        'border-line bg-surface-sunken/60 flex w-[17rem] shrink-0 flex-col rounded-xl border transition-colors',
        isOver && 'border-brand-500/40 bg-brand-500/5',
      )}
      aria-label={`${label} column, ${tasks.length} tasks`}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="text-ink text-[13px] font-semibold">{label}</h3>
          <span className="bg-surface text-ink-subtle tabular rounded-full px-1.5 text-[11px] font-medium">
            {tasks.length}
          </span>
        </div>
        {canEdit ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Add task to ${label}`}
            onClick={() => onCreateTask(status)}
          >
            <Plus />
          </Button>
        ) : null}
      </header>

      <div ref={setNodeRef} className="min-h-24 flex-1 space-y-2 px-2 pb-2">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTask
              key={task.id}
              task={task}
              canEdit={canEdit}
              onOpen={() => onOpenTask(task.id)}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 ? (
          <p className="border-line text-ink-subtle rounded-lg border border-dashed px-3 py-5 text-center text-xs">
            No tasks
          </p>
        ) : null}
      </div>
    </section>
  );
}

function SortableTask({
  task,
  canEdit,
  onOpen,
}: {
  task: TaskCard;
  canEdit: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && 'opacity-40')}
    >
      <TaskCardView
        task={task}
        onOpen={onOpen}
        dragHandleProps={canEdit ? { ...attributes, ...listeners } : undefined}
      />
    </div>
  );
}

function TaskCardView({
  task,
  onOpen,
  dragging,
  dragHandleProps,
}: {
  task: TaskCard;
  onOpen?: () => void;
  dragging?: boolean;
  dragHandleProps?: Record<string, unknown>;
}) {
  const done = task.checklist.filter((c) => c.done).length;
  const overdue = task.dueDate && task.status !== 'DONE' && daysUntil(task.dueDate) < 0;

  return (
    <article
      className={cn(
        'group border-line bg-surface rounded-lg border p-2.5 shadow-xs transition-shadow',
        dragging ? 'rotate-1 shadow-lg' : 'hover:shadow-md',
      )}
    >
      <div className="flex items-start gap-1.5">
        {dragHandleProps ? (
          <button
            type="button"
            {...dragHandleProps}
            aria-label={`Reorder ${task.title}`}
            className="text-ink-subtle mt-0.5 cursor-grab touch-none rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" />
          </button>
        ) : null}

        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open task: ${task.title}`}
          className="focus-visible:ring-brand-500/40 min-w-0 flex-1 rounded text-left focus-visible:ring-2 focus-visible:outline-none"
        >
          <p className="text-ink text-[13px] leading-snug font-medium">{task.title}</p>
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusBadge kind="priority" value={task.priority} size="sm" />
        {task.dueDate ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[11px]',
              overdue ? 'text-danger font-medium' : 'text-ink-subtle',
            )}
          >
            <CalendarDays className="size-3" aria-hidden />
            {formatDate(task.dueDate, 'dd MMM')}
          </span>
        ) : null}
        {task.checklist.length > 0 ? (
          <span className="text-ink-subtle tabular inline-flex items-center gap-1 text-[11px]">
            <CheckSquare className="size-3" aria-hidden />
            {done}/{task.checklist.length}
          </span>
        ) : null}
        {task.commentCount > 0 ? (
          <span className="text-ink-subtle tabular inline-flex items-center gap-1 text-[11px]">
            <MessageSquare className="size-3" aria-hidden />
            {task.commentCount}
          </span>
        ) : null}
        {task.assignee ? (
          <span className="ml-auto">
            <Avatar name={task.assignee.name} color={task.assignee.avatarColor} size="xs" />
          </span>
        ) : null}
      </div>
    </article>
  );
}
