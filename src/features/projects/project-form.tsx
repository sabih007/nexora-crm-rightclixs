'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Label, Select, Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/empty-state';
import { Avatar, Checkbox } from '@/components/ui/misc';
import { statusLabel } from '@/components/shared/status-badge';
import { CURRENCIES, PRIORITY_CURRENCIES } from '@/lib/money';
import {
  PRIORITIES,
  PROJECT_STATUSES,
  projectInputSchema,
  type ProjectFormValues,
  type ProjectInput,
} from './schemas';
import { createProject, updateProject } from './actions';

export function ProjectForm({
  defaults,
  projectId,
  clients,
  members,
  workspaceCurrency,
}: {
  defaults?: Partial<ProjectFormValues>;
  projectId?: string;
  clients: { id: string; name: string; billingCurrency: string }[];
  members: { id: string; name: string; email: string; avatarColor: string }[];
  workspaceCurrency: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(projectId);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [tagDraft, setTagDraft] = React.useState('');

  const form = useForm<ProjectFormValues, unknown, ProjectInput>({
    resolver: zodResolver(projectInputSchema),
    defaultValues: {
      name: defaults?.name ?? '',
      code: defaults?.code ?? null,
      clientId: defaults?.clientId ?? null,
      description: defaults?.description ?? null,
      ownerId: defaults?.ownerId ?? null,
      status: defaults?.status ?? 'PLANNING',
      priority: defaults?.priority ?? 'MEDIUM',
      budgetAmount: defaults?.budgetAmount ?? null,
      currency: defaults?.currency ?? workspaceCurrency,
      startDate: defaults?.startDate ?? null,
      dueDate: defaults?.dueDate ?? null,
      tags: defaults?.tags ?? [],
      memberIds: defaults?.memberIds ?? [],
    },
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  const tags = watch('tags') ?? [];
  const memberIds = watch('memberIds') ?? [];
  const selectedClientId = watch('clientId');

  // Adopting the client's billing currency avoids invoicing mismatches later.
  function onClientChange(clientId: string) {
    setValue('clientId', clientId || null, { shouldDirty: true });
    const client = clients.find((c) => c.id === clientId);
    if (client) setValue('currency', client.billingCurrency, { shouldDirty: true });
  }

  function addTag() {
    const value = tagDraft.trim();
    if (!value || tags.includes(value)) {
      setTagDraft('');
      return;
    }
    setValue('tags', [...tags, value], { shouldDirty: true });
    setTagDraft('');
  }

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const result = isEdit
      ? await updateProject({ id: projectId!, data: values })
      : await createProject(values);

    if (!result.ok) {
      setServerError(result.error);
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          form.setError(field as keyof ProjectFormValues, { message: messages[0] });
        }
      }
      return;
    }

    toast.success(isEdit ? 'Project updated' : 'Project created');
    router.push(`/projects/${result.data.id}`);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {serverError ? <Callout tone="danger">{serverError}</Callout> : null}

      <Card>
        <CardHeader>
          <CardTitle>Project</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Name"
            required
            error={errors.name?.message}
            htmlFor="name"
            className="sm:col-span-2"
          >
            <Input id="name" {...register('name')} autoFocus />
          </Field>

          <Field label="Reference code" htmlFor="code" hint="Optional internal identifier.">
            <Input id="code" placeholder="PRJ-001" {...register('code')} />
          </Field>

          <Field label="Client" error={errors.clientId?.message} htmlFor="clientId">
            <Select
              id="clientId"
              value={selectedClientId ?? ''}
              onChange={(e) => onClientChange(e.target.value)}
            >
              <option value="">Internal (no client)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Description" htmlFor="description" className="sm:col-span-2">
            <Textarea id="description" rows={3} {...register('description')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Planning</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" htmlFor="status">
            <Select id="status" {...register('status')}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel('project', s)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" htmlFor="priority">
            <Select id="priority" {...register('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {statusLabel('priority', p)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Start date" error={errors.startDate?.message} htmlFor="startDate">
            <Input id="startDate" type="date" {...register('startDate')} />
          </Field>

          <Field label="Due date" error={errors.dueDate?.message} htmlFor="dueDate">
            <Input id="dueDate" type="date" {...register('dueDate')} />
          </Field>

          <Field
            label="Budget"
            error={errors.budgetAmount?.message}
            htmlFor="budgetAmount"
            hint="Used for project profitability reporting."
          >
            <Input
              id="budgetAmount"
              inputMode="decimal"
              placeholder="0.00"
              {...register('budgetAmount')}
            />
          </Field>

          <Field label="Currency" required error={errors.currency?.message} htmlFor="currency">
            <Select id="currency" {...register('currency')}>
              <optgroup label="Common">
                {PRIORITY_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </optgroup>
              <optgroup label="All currencies">
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>

          <div className="sm:col-span-2">
            <Label>Tags</Label>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {tags.map((tag) => (
                <Badge key={tag} tone="brand" className="gap-1 pr-1">
                  {tag}
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag}`}
                    onClick={() =>
                      setValue(
                        'tags',
                        tags.filter((t) => t !== tag),
                        { shouldDirty: true },
                      )
                    }
                    className="hover:bg-brand-500/20 rounded-full p-0.5"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
              <Input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                onBlur={addTag}
                placeholder="Add a tag…"
                aria-label="Add a tag"
                className="h-8 w-36"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Team</CardTitle>
            <p className="text-ink-subtle mt-0.5 text-xs">
              Members can see this project even if their role is limited to assignments.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Owner" error={errors.ownerId?.message} htmlFor="ownerId">
            <Select id="ownerId" {...register('ownerId')}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>

          <fieldset>
            <legend className="text-ink text-[13px] font-medium">Members</legend>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {members.map((member) => {
                const checked = memberIds.includes(member.id);
                return (
                  <li key={member.id}>
                    <label className="border-line hover:bg-surface-hover flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          setValue(
                            'memberIds',
                            next === true
                              ? [...memberIds, member.id]
                              : memberIds.filter((id) => id !== member.id),
                            { shouldDirty: true },
                          )
                        }
                      />
                      <Avatar name={member.name} color={member.avatarColor} size="sm" />
                      <span className="min-w-0">
                        <span className="text-ink block truncate text-[13px]">{member.name}</span>
                        <span className="text-ink-subtle block truncate text-[11px]">
                          {member.email}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {isEdit ? 'Save changes' : 'Create project'}
        </Button>
      </div>
    </form>
  );
}
