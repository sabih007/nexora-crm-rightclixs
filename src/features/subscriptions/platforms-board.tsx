'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExternalLink, Globe, Link2, Pencil, Plus, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { SearchInput } from '@/components/shared/data-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { CurrencyAmount } from '@/components/shared/currency-amount';
import { PLATFORM_CATEGORIES } from './schemas';
import { createPlatform, deletePlatform, linkCardToPlatform, updatePlatform } from './actions';
import { formatDate } from '@/lib/dates';

interface PlatformRow {
  id: string;
  name: string;
  category: string;
  websiteUrl: string | null;
  cancellationUrl: string | null;
  accountIdentifier: string | null;
  notes: string | null;
  owner: { id: string; name: string } | null;
  cards: {
    linkId: string;
    cardId: string;
    nickname: string;
    last4: string;
    brand: string;
    status: string;
    linkedAt: Date | null;
    removedAt: Date | null;
    lastVerifiedAt: Date | null;
  }[];
  subscriptions: {
    id: string;
    planName: string;
    amount: string;
    currency: string;
    status: string;
    nextChargeAt: Date;
    monthlyEquivalent: string;
  }[];
}

/** Platform registry: who we pay, which cards are saved there, how to cancel. */
export function PlatformsBoard({
  platforms,
  cards,
  members,
  permissions,
}: {
  platforms: PlatformRow[];
  cards: { id: string; nickname: string; last4: string }[];
  members: { id: string; name: string }[];
  permissions: { create: boolean; update: boolean; delete: boolean; manageLinks: boolean };
}) {
  const router = useRouter();
  const [search, setSearch] = React.useState('');
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<PlatformRow | null>(null);
  const [linkTarget, setLinkTarget] = React.useState<PlatformRow | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<PlatformRow | null>(null);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return platforms;
    return platforms.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term) ||
        p.cards.some((c) => c.last4.includes(term) || c.nickname.toLowerCase().includes(term)),
    );
  }, [platforms, search]);

  async function handleDelete() {
    if (!deleteTarget) return;
    const result = await deletePlatform({ id: deleteTarget.id });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Platform removed');
    setDeleteTarget(null);
    router.refresh();
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search platforms or cards…"
          className="w-full sm:w-64"
        />
        {permissions.create ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus /> Add a platform
          </Button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Globe}
          title={search ? 'No platforms match' : 'No platforms recorded'}
          description={
            search
              ? 'Try a different search term.'
              : 'Record the services the office pays for, so you know where each card is saved and how to cancel.'
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((platform) => {
            const activeCards = platform.cards.filter((c) => c.status === 'ACTIVE');
            const removedCards = platform.cards.filter((c) => c.status === 'REMOVED');
            const activeSubs = platform.subscriptions.filter((s) =>
              ['ACTIVE', 'TRIAL'].includes(s.status),
            );

            return (
              <Card key={platform.id}>
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      <span className="truncate">{platform.name}</span>
                      <Badge tone="outline" size="sm">
                        {platform.category}
                      </Badge>
                    </CardTitle>
                    <div className="text-ink-subtle mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                      {platform.accountIdentifier ? (
                        <span className="truncate">{platform.accountIdentifier}</span>
                      ) : null}
                      {platform.owner ? <span>owner {platform.owner.name}</span> : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-1">
                    {permissions.update ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${platform.name}`}
                        onClick={() => {
                          setEditing(platform);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil />
                      </Button>
                    ) : null}
                    {permissions.delete ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${platform.name}`}
                        onClick={() => setDeleteTarget(platform)}
                      >
                        <Trash2 className="text-danger" />
                      </Button>
                    ) : null}
                  </div>
                </CardHeader>

                <CardContent className="space-y-3.5">
                  <div>
                    <p className="text-ink-subtle mb-1 flex items-center justify-between text-[11px] font-semibold tracking-wide uppercase">
                      <span>Cards saved here</span>
                      {permissions.manageLinks ? (
                        <button
                          type="button"
                          onClick={() => setLinkTarget(platform)}
                          aria-label={`Record a card saved on ${platform.name}`}
                          className="text-brand-500 inline-flex items-center gap-1 rounded text-[11px] font-medium tracking-normal normal-case hover:underline"
                        >
                          <Link2 className="size-3" aria-hidden /> Record a card
                        </button>
                      ) : null}
                    </p>
                    {activeCards.length === 0 && removedCards.length === 0 ? (
                      <p className="text-ink-subtle text-sm">None recorded.</p>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {activeCards.map((card) => (
                          <li key={card.linkId}>
                            <Badge
                              tone="success"
                              title={
                                card.lastVerifiedAt
                                  ? `Last confirmed ${formatDate(card.lastVerifiedAt)}`
                                  : 'Never confirmed'
                              }
                            >
                              <span className="font-mono">···· {card.last4}</span>
                              <span className="opacity-75">{card.nickname}</span>
                            </Badge>
                          </li>
                        ))}
                        {removedCards.map((card) => (
                          <li key={card.linkId}>
                            <Badge tone="outline" className="line-through opacity-70">
                              <XCircle className="size-3" aria-hidden />
                              <span className="font-mono">···· {card.last4}</span>
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {activeSubs.length > 0 ? (
                    <div>
                      <p className="text-ink-subtle mb-1 text-[11px] font-semibold tracking-wide uppercase">
                        Subscriptions
                      </p>
                      <ul className="space-y-1">
                        {activeSubs.map((sub) => (
                          <li key={sub.id} className="flex items-center gap-2 text-sm">
                            <Link
                              href={`/subscriptions/${sub.id}`}
                              className="text-ink hover:text-brand-500 min-w-0 flex-1 truncate hover:underline"
                            >
                              {sub.planName}
                            </Link>
                            <StatusBadge kind="subscription" value={sub.status} size="sm" />
                            <span className="text-ink-subtle text-[11px] whitespace-nowrap">
                              next {formatDate(sub.nextChargeAt, 'dd MMM')}
                            </span>
                            <CurrencyAmount
                              amount={sub.amount}
                              currency={sub.currency}
                              className="font-medium"
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="border-line flex flex-wrap gap-3 border-t pt-2.5 text-xs">
                    {platform.websiteUrl ? (
                      <a
                        href={normaliseUrl(platform.websiteUrl)}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-brand-500 inline-flex items-center gap-1 hover:underline"
                      >
                        <ExternalLink className="size-3" aria-hidden /> Website
                      </a>
                    ) : null}
                    {platform.cancellationUrl ? (
                      <a
                        href={normaliseUrl(platform.cancellationUrl)}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-brand-500 inline-flex items-center gap-1 hover:underline"
                      >
                        <ExternalLink className="size-3" aria-hidden /> Billing / cancel
                      </a>
                    ) : null}
                    <Link
                      href={`/subscriptions?platformId=${platform.id}`}
                      className="text-brand-500 hover:underline"
                    >
                      All subscriptions →
                    </Link>
                  </div>

                  {platform.notes ? (
                    <p className="text-ink-subtle text-xs">{platform.notes}</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <PlatformFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        platform={editing}
        members={members}
      />

      <RecordCardDialog platform={linkTarget} cards={cards} onClose={() => setLinkTarget(null)} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget?.name ?? 'this platform'}?`}
        description="The platform and its card links are removed from this registry. Nothing changes on the platform itself, and any subscriptions must be removed first."
        confirmLabel="Delete platform"
        onConfirm={handleDelete}
      />
    </>
  );
}

/** Ensure a stored host-only value still renders as an absolute https link. */
function normaliseUrl(url: string): string {
  return url.startsWith('http') ? url : `https://${url}`;
}

function PlatformFormDialog({
  open,
  onOpenChange,
  platform,
  members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: PlatformRow | null;
  members: { id: string; name: string }[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <PlatformFormBody
          key={platform?.id ?? 'new'}
          platform={platform}
          members={members}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function PlatformFormBody({
  platform,
  members,
  onClose,
}: {
  platform: PlatformRow | null;
  members: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const isEdit = Boolean(platform);

  const [name, setName] = React.useState(platform?.name ?? '');
  const [category, setCategory] = React.useState(platform?.category ?? 'Other');
  const [websiteUrl, setWebsiteUrl] = React.useState(platform?.websiteUrl ?? '');
  const [cancellationUrl, setCancellationUrl] = React.useState(platform?.cancellationUrl ?? '');
  const [accountIdentifier, setAccountIdentifier] = React.useState(
    platform?.accountIdentifier ?? '',
  );
  const [ownerId, setOwnerId] = React.useState(platform?.owner?.id ?? '');
  const [notes, setNotes] = React.useState(platform?.notes ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        category,
        websiteUrl: websiteUrl || null,
        cancellationUrl: cancellationUrl || null,
        accountIdentifier: accountIdentifier || null,
        ownerId: ownerId || null,
        notes: notes || null,
      };

      const result = isEdit
        ? await updatePlatform({ id: platform!.id, data: payload })
        : await createPlatform(payload);

      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(isEdit ? 'Platform updated' : 'Platform added');
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit platform' : 'Add a platform'}</DialogTitle>
        <DialogDescription>
          A service the office pays for. Record the login identifier, never a password.
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required htmlFor="platform-name">
            <Input
              id="platform-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>

          <Field label="Category" htmlFor="platform-category">
            <Select
              id="platform-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {PLATFORM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Website" htmlFor="platform-url">
            <Input
              id="platform-url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="example.com"
            />
          </Field>

          <Field
            label="Billing / cancellation page"
            htmlFor="platform-cancel-url"
            hint="Where to go to stop paying."
          >
            <Input
              id="platform-cancel-url"
              value={cancellationUrl}
              onChange={(e) => setCancellationUrl(e.target.value)}
            />
          </Field>

          <Field
            label="Account identifier"
            htmlFor="platform-account"
            hint="The login email or username — never a password."
          >
            <Input
              id="platform-account"
              value={accountIdentifier}
              onChange={(e) => setAccountIdentifier(e.target.value)}
              placeholder="billing@office.com"
              autoComplete="off"
            />
          </Field>

          <Field label="Owner" htmlFor="platform-owner">
            <Select
              id="platform-owner"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Notes" htmlFor="platform-notes">
          <Textarea
            id="platform-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} loading={busy} disabled={!name.trim()}>
          {isEdit ? 'Save changes' : 'Add platform'}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Record that a card is saved on a platform, from the platform side.
 *
 * As everywhere in this module, it updates the inventory only — it cannot
 * add a card to the external service.
 */
function RecordCardDialog({
  platform,
  cards,
  onClose,
}: {
  platform: PlatformRow | null;
  cards: { id: string; nickname: string; last4: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [cardId, setCardId] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const alreadyLinked = new Set(
    platform?.cards.filter((c) => c.status === 'ACTIVE').map((c) => c.cardId) ?? [],
  );
  const available = cards.filter((c) => !alreadyLinked.has(c.id));

  async function handleSubmit() {
    if (!platform || !cardId) return;
    setBusy(true);
    try {
      const result = await linkCardToPlatform({
        platformId: platform.id,
        cardId,
        status: 'ACTIVE',
        linkedAt: null,
        responsibleId: null,
        notes: null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Recorded in the inventory');
      setCardId('');
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={platform !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a card saved on {platform?.name}</DialogTitle>
          <DialogDescription>
            Notes which office card is stored on this platform. It does not add the card to{' '}
            {platform?.name} — do that on the platform itself.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {available.length === 0 ? (
            <p className="text-ink-subtle text-sm">
              Every active card is already recorded against this platform.
            </p>
          ) : (
            <Field label="Card" required htmlFor="record-card">
              <Select id="record-card" value={cardId} onChange={(e) => setCardId(e.target.value)}>
                <option value="">Select a card…</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nickname} ···· {c.last4}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={busy} disabled={!cardId}>
            Record card
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
