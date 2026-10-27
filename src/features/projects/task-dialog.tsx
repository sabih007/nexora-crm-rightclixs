'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input, Label, Select, Textarea } from '@/components/ui/field';
import { Avatar, Checkbox } from '@/components/ui/misc';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PRIORITIES, TASK_STATUSES } from './schemas';
import { addTaskComment, createTask, deleteTask, updateTask } from './actions';
import { statusLabel } from '@/components/shared/status-badge';
import { formatDateTime, toDateInput } from '@/lib/dates';

/**
 * Task create / edit dialog.
 *
 * One component serves both: `task` absent means create. Checklist items and
 * comments are edited in place so a task never needs a separate page.
 */

export interface TaskDialogTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | string | null;
  checklist: { id: string; label: string; done: boolean }[];
  assignee: { id: string; name: string; avatarColor: string } | null;
  comments?: {
    id: string;
    body: string;
    createdAt: Date | string;
    author: { id: string; name: string; avatarColor: string };
  }[];
}

export function TaskDialog({
  open,
  onOpenChange,
  projectId,
  task,
  defaultStatus = 'TODO',
  members,
  canEdit,
  canDelete,
  canComment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  task?: TaskDialogTask | null;
  defaultStatus?: string;
  members: { id: string; name: string; avatarColor: string }[];
  canEdit: boolean;
  canDelete: boolean;
  canComment: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {/* Keyed so switching between tasks resets all local state. */}
        <TaskDialogBody
          key={task?.id ?? `new-${defaultStatus}`}
          projectId={projectId}
          task={task}
          defaultStatus={defaultStatus}
          members={members}
          canEdit={canEdit}
          canDelete={canDelete}
          canComment={canComment}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function TaskDialogBody({
  projectId,
  task,
  defaultStatus,
  members,
  canEdit,
  canDelete,
  canComment,
  onClose,
}: {
  projectId: string;
  task?: TaskDialogTask | null;
  defaultStatus: string;
  members: { id: string; name: string; avatarColor: string }[];
  canEdit: boolean;
  canDelete: boolean;
  canComment: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const isEdit = Boolean(task);

  const [title, setTitle] = React.useState(task?.title ?? '');
  const [description, setDescription] = React.useState(task?.description ?? '');
  const [status, setStatus] = React.useState(task?.status ?? defaultStatus);
  const [priority, setPriority] = React.useState(task?.priority ?? 'MEDIUM');
  const [assigneeId, setAssigneeId] = React.useState(task?.assignee?.id ?? '');
  const [dueDate, setDueDate] = React.useState(toDateInput(task?.dueDate ?? null));
  const [checklist, setChecklist] = React.useState(task?.checklist ?? []);
  const [checklistDraft, setChecklistDraft] = React.useState('');
  const [comment, setComment] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  function addChecklistItem() {
    const label = checklistDraft.trim();
    if (!label) return;
    setChecklist((items) => [
      ...items,
      { id: `c${Date.now()}${items.length}`, label, done: false },
    ]);
    setChecklistDraft('');
  }

  async function handleSave() {
    setError(null);
    if (!title.trim()) {
      setError('A task title is required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        assigneeId: assigneeId || null,
        status: status as (typeof TASK_STATUSES)[number],
        priority: priority as (typeof PRIORITIES)[number],
        dueDate: dueDate || null,
        checklist,
      };

      const result = isEdit
        ? await updateTask({ id: task!.id, data: payload })
        : await createTask({ ...payload, projectId });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(isEdit ? 'Task updated' : 'Task created');
      onClose();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleComment() {
    if (!task || !comment.trim()) return;
    const result = await addTaskComment({ taskId: task.id, body: comment.trim() });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setComment('');
    router.refresh();
  }

  async function handleDelete() {
    if (!task) return;
    const result = await deleteTask({ id: task.id });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Task deleted');
    setConfirmDelete(false);
    onClose();
    router.refresh();
  }

  const checklistDone = checklist.filter((c) => c.done).length;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Task' : 'New task'}</DialogTitle>
        <DialogDescription>
          {isEdit ? 'Update the task, its checklist and comments.' : 'Add a task to this project.'}
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4">
        {error ? (
          <p
            role="alert"
            className="border-danger/25 bg-danger-soft text-danger rounded-lg border px-3 py-2 text-sm"
          >
            {error}
          </p>
        ) : null}

        <Field label="Title" required htmlFor="task-title">
          <Input
            id="task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={!canEdit}
            autoFocus={!isEdit}
          />
        </Field>

        <Field label="Description" htmlFor="task-description">
          <Textarea
            id="task-description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canEdit}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Status" htmlFor="task-status">
            <Select
              id="task-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={!canEdit}
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel('task', s)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" htmlFor="task-priority">
            <Select
              id="task-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              disabled={!canEdit}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {statusLabel('priority', p)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Assignee" htmlFor="task-assignee">
            <Select
              id="task-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              disabled={!canEdit}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Due date" htmlFor="task-due">
            <Input
              id="task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={!canEdit}
            />
          </Field>
        </div>

        <div>
          <Label>
            Checklist{' '}
            {checklist.length > 0 ? (
              <span className="text-ink-subtle tabular font-normal">
                ({checklistDone}/{checklist.length})
              </span>
            ) : null}
          </Label>
          <ul className="mt-1.5 space-y-1.5">
            {checklist.map((item, index) => (
              <li key={item.id} className="flex items-center gap-2">
                <Checkbox
                  checked={item.done}
                  disabled={!canEdit}
                  onCheckedChange={(checked) =>
                    setChecklist((items) =>
                      items.map((c, i) => (i === index ? { ...c, done: checked === true } : c)),
                    )
                  }
                  aria-label={item.label}
                />
                <span
                  className={
                    item.done
                      ? 'text-ink-subtle flex-1 text-sm line-through'
                      : 'text-ink flex-1 text-sm'
                  }
                >
                  {item.label}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={`Remove ${item.label}`}
                    onClick={() => setChecklist((items) => items.filter((_, i) => i !== index))}
                    className="text-ink-subtle hover:text-danger rounded p-1"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {canEdit ? (
            <div className="mt-2 flex gap-2">
              <Input
                value={checklistDraft}
                onChange={(e) => setChecklistDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addChecklistItem();
                  }
                }}
                placeholder="Add a checklist item…"
                aria-label="Add a checklist item"
                className="h-8"
              />
              <Button type="button" variant="secondary" size="sm" onClick={addChecklistItem}>
                <Plus /> Add
              </Button>
            </div>
          ) : null}
        </div>

        {isEdit && task?.comments ? (
          <div className="border-line border-t pt-4">
            <Label>Comments</Label>
            {task.comments.length === 0 ? (
              <p className="text-ink-subtle mt-1.5 text-sm">No comments yet.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {task.comments.map((c) => (
                  <li key={c.id} className="flex gap-2.5">
                    <Avatar name={c.author.name} color={c.author.avatarColor} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs">
                        <span className="text-ink font-medium">{c.author.name}</span>{' '}
                        <span className="text-ink-subtle">{formatDateTime(c.createdAt)}</span>
                      </p>
                      <p className="text-ink-muted mt-0.5 text-sm whitespace-pre-wrap">{c.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {canComment ? (
              <div className="mt-3 flex gap-2">
                <Textarea
                  rows={2}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Write a comment…"
                  aria-label="Write a comment"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleComment}
                  disabled={!comment.trim()}
                  aria-label="Post comment"
                >
                  <Send />
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogBody>

      <DialogFooter>
        {isEdit && canDelete ? (
          <Button
            type="button"
            variant="danger-outline"
            className="sm:mr-auto"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 /> Delete
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
        {canEdit ? (
          <Button type="button" onClick={handleSave} loading={saving}>
            {isEdit ? 'Save changes' : 'Create task'}
          </Button>
        ) : null}
      </DialogFooter>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this task?"
        description="The task and its comments are permanently removed. This cannot be undone."
        confirmLabel="Delete task"
        onConfirm={handleDelete}
      />
    </>
  );
}
