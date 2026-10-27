'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Label, Select, Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/empty-state';
import { Checkbox } from '@/components/ui/misc';
import { CURRENCIES, PRIORITY_CURRENCIES } from '@/lib/money';
import { clientInputSchema, type ClientInput, type ClientFormValues } from './schemas';
import { checkClientDuplicates, createClient, updateClient } from './actions';

/**
 * Create / edit client form.
 *
 * Duplicate detection runs on blur of the name field and surfaces a warning
 * the user can override deliberately — it never silently blocks a legitimate
 * second entity with a similar name.
 */

export interface ClientFormDefaults extends Partial<ClientFormValues> {
  id?: string;
}

interface Duplicate {
  id: string;
  name: string;
  email: string | null;
  status: string;
}

export function ClientForm({
  defaults,
  workspaceCurrency,
}: {
  defaults?: ClientFormDefaults;
  workspaceCurrency: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(defaults?.id);
  const [duplicates, setDuplicates] = React.useState<Duplicate[]>([]);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [tagDraft, setTagDraft] = React.useState('');

  // Three generics: the raw form shape, the context, and the parsed output.
  // Zod applies defaults and transforms, so input and output differ.
  const form = useForm<ClientFormValues, unknown, ClientInput>({
    resolver: zodResolver(clientInputSchema),
    defaultValues: {
      type: defaults?.type ?? 'COMPANY',
      name: defaults?.name ?? '',
      email: defaults?.email ?? null,
      phone: defaults?.phone ?? null,
      website: defaults?.website ?? null,
      billingCurrency: defaults?.billingCurrency ?? workspaceCurrency,
      taxId: defaults?.taxId ?? null,
      status: defaults?.status ?? 'ACTIVE',
      tags: defaults?.tags ?? [],
      notes: defaults?.notes ?? null,
      address: defaults?.address ?? {},
      contacts: defaults?.contacts ?? [],
      allowDuplicate: false,
    },
  });

  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  const contacts = useFieldArray({ control, name: 'contacts' });
  // `tags` is optional in the raw form shape (Zod supplies the default), so
  // normalise it once here rather than guarding at every use.
  const tags = watch('tags') ?? [];
  const clientType = watch('type');

  async function runDuplicateCheck() {
    const name = form.getValues('name')?.trim();
    if (!name || name.length < 2) {
      setDuplicates([]);
      return;
    }
    const result = await checkClientDuplicates({
      name,
      email: form.getValues('email') ?? null,
      excludeId: defaults?.id,
    });
    setDuplicates(result.ok ? result.data : []);
  }

  function addTag() {
    const value = tagDraft.trim();
    if (!value) return;
    if (tags.includes(value)) {
      setTagDraft('');
      return;
    }
    setValue('tags', [...tags, value], { shouldDirty: true });
    setTagDraft('');
  }

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const payload = { ...values, allowDuplicate: duplicates.length > 0 };

    const result = isEdit
      ? await updateClient({ ...payload, id: defaults!.id! })
      : await createClient(payload);

    if (!result.ok) {
      setServerError(result.error);
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          form.setError(field as keyof ClientFormValues, { message: messages[0] });
        }
      }
      return;
    }

    toast.success(isEdit ? 'Client updated' : 'Client created');
    router.push(`/clients/${result.data.id}`);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {serverError ? <Callout tone="danger">{serverError}</Callout> : null}

      {duplicates.length > 0 ? (
        <Callout tone="warning" title="Possible duplicate">
          <div className="space-y-1.5">
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {duplicates.length === 1 ? 'A client' : `${duplicates.length} clients`} with a very
                similar name or the same email already exist. Saving will create a separate record.
              </span>
            </p>
            <ul className="space-y-1">
              {duplicates.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/clients/${d.id}`}
                    target="_blank"
                    className="text-brand-500 hover:underline"
                  >
                    {d.name}
                  </Link>
                  {d.email ? <span className="text-ink-subtle"> · {d.email}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </Callout>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="type">
            <Select id="type" {...register('type')}>
              <option value="COMPANY">Company</option>
              <option value="INDIVIDUAL">Individual</option>
            </Select>
          </Field>

          <Field label="Status" htmlFor="status">
            <Select id="status" {...register('status')}>
              <option value="ACTIVE">Active</option>
              <option value="PROSPECT">Prospect</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </Field>

          <Field
            label={clientType === 'COMPANY' ? 'Company name' : 'Full name'}
            required
            error={errors.name?.message}
            htmlFor="name"
            className="sm:col-span-2"
          >
            <Input id="name" {...register('name')} onBlur={runDuplicateCheck} autoFocus />
          </Field>

          <Field label="Email" error={errors.email?.message} htmlFor="email">
            <Input id="email" type="email" {...register('email')} onBlur={runDuplicateCheck} />
          </Field>

          <Field label="Phone" error={errors.phone?.message} htmlFor="phone">
            <Input id="phone" type="tel" {...register('phone')} />
          </Field>

          <Field
            label="Website"
            error={errors.website?.message}
            htmlFor="website"
            hint="http(s) addresses only"
          >
            <Input id="website" placeholder="example.com" {...register('website')} />
          </Field>

          <Field
            label="Tax identifier"
            error={errors.taxId?.message}
            htmlFor="taxId"
            hint="NTN, VAT number, or equivalent"
          >
            <Input id="taxId" {...register('taxId')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Billing currency"
            required
            error={errors.billingCurrency?.message}
            htmlFor="billingCurrency"
            hint="Invoices for this client default to this currency."
          >
            <Select id="billingCurrency" {...register('billingCurrency')}>
              <optgroup label="Common">
                {PRIORITY_CURRENCIES.map((code) => {
                  const match = CURRENCIES.find((c) => c.code === code);
                  return (
                    <option key={code} value={code}>
                      {code} — {match?.name ?? code}
                    </option>
                  );
                })}
              </optgroup>
              <optgroup label="All currencies">
                {CURRENCIES.filter(
                  (c) => !PRIORITY_CURRENCIES.includes(c.code as (typeof PRIORITY_CURRENCIES)[number]),
                ).map((c) => (
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
                    className="rounded-full p-0.5 hover:bg-brand-500/20"
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
          <CardTitle>Billing address</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Address line 1" htmlFor="line1" className="sm:col-span-2">
            <Input id="line1" {...register('address.line1')} />
          </Field>
          <Field label="Address line 2" htmlFor="line2" className="sm:col-span-2">
            <Input id="line2" {...register('address.line2')} />
          </Field>
          <Field label="City" htmlFor="city">
            <Input id="city" {...register('address.city')} />
          </Field>
          <Field label="State / province" htmlFor="state">
            <Input id="state" {...register('address.state')} />
          </Field>
          <Field label="Postal code" htmlFor="postalCode">
            <Input id="postalCode" {...register('address.postalCode')} />
          </Field>
          <Field label="Country" htmlFor="country">
            <Input id="country" {...register('address.country')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Contacts</CardTitle>
            <p className="mt-0.5 text-xs text-ink-subtle">
              People to reach at this client. Mark one as primary.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              contacts.append({
                name: '',
                email: null,
                phone: null,
                position: null,
                isPrimary: contacts.fields.length === 0,
              })
            }
          >
            <Plus /> Add contact
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {contacts.fields.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-ink-subtle">
              No contacts added.
            </p>
          ) : (
            contacts.fields.map((field, index) => (
              <div
                key={field.id}
                className="grid gap-3 rounded-lg border border-line bg-surface-sunken/50 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
              >
                <Field label="Name" required error={errors.contacts?.[index]?.name?.message}>
                  <Input {...register(`contacts.${index}.name`)} />
                </Field>
                <Field label="Email" error={errors.contacts?.[index]?.email?.message}>
                  <Input type="email" {...register(`contacts.${index}.email`)} />
                </Field>
                <Field label="Phone">
                  <Input type="tel" {...register(`contacts.${index}.phone`)} />
                </Field>
                <div className="flex items-end gap-2 pb-0.5">
                  <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-ink-muted">
                    <Checkbox
                      checked={watch(`contacts.${index}.isPrimary`)}
                      onCheckedChange={(checked) => {
                        // Exactly one primary contact.
                        contacts.fields.forEach((_, i) =>
                          setValue(`contacts.${i}.isPrimary`, i === index && checked === true, {
                            shouldDirty: true,
                          }),
                        );
                      }}
                    />
                    Primary
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove contact ${index + 1}`}
                    onClick={() => contacts.remove(index)}
                  >
                    <Trash2 className="text-danger" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Field label="Internal notes" htmlFor="notes" hint="Visible to roles with full client access.">
            <Textarea id="notes" rows={4} {...register('notes')} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {isEdit ? 'Save changes' : duplicates.length > 0 ? 'Create anyway' : 'Create client'}
        </Button>
      </div>
    </form>
  );
}
