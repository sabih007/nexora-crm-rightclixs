'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  CircleAlert,
  CreditCard,
  Link2,
  Link2Off,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
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
import { Tooltip } from '@/components/ui/misc';
import { StatusBadge } from '@/components/shared/status-badge';
import { MultiCurrencyAmount } from './multi-currency-amount';
import { CardFormDialog } from './card-form-dialog';
import type { CardWithFootprint } from './queries';
import { deleteCard, linkCardToPlatform, markLinkRemoved, verifyLink } from './actions';
import { formatDate, toDateInput } from '@/lib/dates';
import { cn } from '@/lib/utils';

const BRAND_LABELS: Record<string, string> = {
  VISA: 'Visa',
  MASTERCARD: 'Mastercard',
  AMEX: 'Amex',
  DISCOVER: 'Discover',
  UNIONPAY: 'UnionPay',
  JCB: 'JCB',
  OTHER: 'Card',
};

/**
 * Card inventory board.
 *
 * Each card answers the question the spec poses directly: *where is this card
 * saved?* — the platforms it is recorded on, which were removed and when, and
 * which have not been verified recently.
 */
export function CardsBoard({
  cards,
  platforms,
  members,
  permissions,
}: {
  cards: CardWithFootprint[];
  platforms: { id: string; name: string; category: string }[];
  members: { id: string; name: string }[];
  permissions: { create: boolean; update: boolean; delete: boolean; manageLinks: boolean };
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CardWithFootprint | null>(null);
  const [linkTarget, setLinkTarget] = React.useState<CardWithFootprint | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<{
    linkId: string;
    cardName: string;
    platformName: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<CardWithFootprint | null>(null);

  async function handleVerify(linkId: string) {
    const result = await verifyLink({ id: linkId });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Marked as verified today');
    router.refresh();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const result = await deleteCard({ id: deleteTarget.id });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Card removed from the inventory');
    setDeleteTarget(null);
    router.refresh();
  }

  if (cards.length === 0) {
    return (
      <>
        <EmptyState
          icon={CreditCard}
          title="No cards recorded"
          description="Add a card to track which platforms it is saved on and what it pays for."
          action={
            permissions.create ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus /> Add a card
              </Button>
            ) : null
          }
        />
        <CardFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          members={members}
          card={null}
        />
      </>
    );
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        {permissions.create ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus /> Add a card
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.id} className={cn(card.status !== 'ACTIVE' && 'opacity-80')}>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <span className="truncate">{card.nickname}</span>
                  <StatusBadge kind="card" value={card.status} size="sm" />
                  {card.isExpired && card.status === 'ACTIVE' ? (
                    <Badge tone="warning" size="sm">
                      Expiry passed
                    </Badge>
                  ) : null}
                </CardTitle>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                  <span className="font-mono tabular">
                    {BRAND_LABELS[card.brand] ?? 'Card'} ···· {card.last4}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{card.issuer}</span>
                  {card.expiryMonth && card.expiryYear ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="tabular">
                        {String(card.expiryMonth).padStart(2, '0')}/
                        {String(card.expiryYear).slice(-2)}
                      </span>
                    </>
                  ) : null}
                </p>
                {card.owner ? (
                  <p className="mt-0.5 text-xs text-ink-subtle">Held by {card.owner.name}</p>
                ) : null}
              </div>

              <div className="flex shrink-0 gap-1">
                {permissions.update ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${card.nickname}`}
                    onClick={() => {
                      setEditing(card);
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
                    aria-label={`Delete ${card.nickname}`}
                    onClick={() => setDeleteTarget(card)}
                  >
                    <Trash2 className="text-danger" />
                  </Button>
                ) : null}
              </div>
            </CardHeader>

            <CardContent className="space-y-3.5">
              <div className="flex items-baseline justify-between rounded-lg bg-surface-sunken px-3 py-2">
                <span className="text-xs text-ink-subtle">Monthly commitment</span>
                <MultiCurrencyAmount amounts={card.monthlyByCurrency} size="md" emptyLabel="None" />
              </div>

              <div>
                <p className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                  <span>Saved on</span>
                  {permissions.manageLinks ? (
                    <button
                      type="button"
                      onClick={() => setLinkTarget(card)}
                      className="inline-flex items-center gap-1 rounded text-[11px] font-medium normal-case tracking-normal text-brand-500 hover:underline"
                    >
                      <Link2 className="size-3" aria-hidden /> Link a platform
                    </button>
                  ) : null}
                </p>

                {card.activePlatforms.length === 0 &&
                card.unverifiedPlatforms.length === 0 &&
                card.removedPlatforms.length === 0 ? (
                  <p className="text-sm text-ink-subtle">
                    No platforms recorded for this card yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {card.activePlatforms.map((platform) => (
                      <li
                        key={platform.linkId}
                        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-surface-hover"
                      >
                        <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-ink">{platform.name}</span>
                        <Tooltip
                          content={
                            platform.lastVerifiedAt
                              ? `Last confirmed ${formatDate(platform.lastVerifiedAt)}`
                              : 'Never confirmed'
                          }
                        >
                          <span className="whitespace-nowrap text-[11px] text-ink-subtle">
                            {platform.lastVerifiedAt
                              ? formatDate(platform.lastVerifiedAt, 'dd MMM yy')
                              : 'unverified'}
                          </span>
                        </Tooltip>
                        {permissions.manageLinks ? (
                          <>
                            <Tooltip content="Confirm the card is still saved on this platform">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Verify ${card.nickname} on ${platform.name}`}
                                onClick={() => handleVerify(platform.linkId)}
                              >
                                <BadgeCheck className="size-3.5" />
                              </Button>
                            </Tooltip>
                            <Tooltip content="Record that the card was removed from this platform">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Mark ${card.nickname} removed from ${platform.name}`}
                                onClick={() =>
                                  setRemoveTarget({
                                    linkId: platform.linkId,
                                    cardName: card.nickname,
                                    platformName: platform.name,
                                  })
                                }
                              >
                                <Link2Off className="size-3.5 text-danger" />
                              </Button>
                            </Tooltip>
                          </>
                        ) : null}
                      </li>
                    ))}

                    {card.unverifiedPlatforms.map((platform) => (
                      <li
                        key={platform.linkId}
                        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm"
                      >
                        <CircleAlert className="size-3 shrink-0 text-warning" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-ink-muted">
                          {platform.name}
                        </span>
                        <span className="text-[11px] text-warning">unverified</span>
                      </li>
                    ))}

                    {card.removedPlatforms.map((platform) => (
                      <li
                        key={platform.linkId}
                        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm"
                      >
                        <span className="size-1.5 shrink-0 rounded-full bg-line-strong" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-ink-subtle line-through">
                          {platform.name}
                        </span>
                        <span className="whitespace-nowrap text-[11px] text-ink-subtle">
                          removed {platform.removedAt ? formatDate(platform.removedAt, 'dd MMM yy') : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {card.subscriptionCount > 0 ? (
                <Link
                  href={`/subscriptions?cardId=${card.id}`}
                  className="inline-block text-xs font-medium text-brand-500 hover:underline"
                >
                  View {card.subscriptionCount} subscription
                  {card.subscriptionCount === 1 ? '' : 's'} on this card →
                </Link>
              ) : null}

              {card.notes ? (
                <p className="border-t border-line pt-2.5 text-xs text-ink-subtle">{card.notes}</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <CardFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        members={members}
        card={editing}
      />

      <LinkPlatformDialog
        card={linkTarget}
        platforms={platforms}
        members={members}
        onClose={() => setLinkTarget(null)}
      />

      <MarkRemovedDialog target={removeTarget} onClose={() => setRemoveTarget(null)} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget?.nickname ?? 'this card'}?`}
        description="The card and its platform links are removed from this inventory. Nothing changes on the platforms themselves, and subscriptions must be moved first."
        confirmLabel="Delete card"
        onConfirm={handleDelete}
      />
    </>
  );
}

function LinkPlatformDialog({
  card,
  platforms,
  members,
  onClose,
}: {
  card: CardWithFootprint | null;
  platforms: { id: string; name: string }[];
  members: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [platformId, setPlatformId] = React.useState('');
  const [responsibleId, setResponsibleId] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function handleSubmit() {
    if (!card || !platformId) return;
    setBusy(true);
    try {
      const result = await linkCardToPlatform({
        platformId,
        cardId: card.id,
        status: 'ACTIVE',
        linkedAt: toDateInput(new Date()),
        responsibleId: responsibleId || null,
        notes: notes || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Recorded in the inventory');
      setPlatformId('');
      setNotes('');
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={card !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record where {card?.nickname} is saved</DialogTitle>
          <DialogDescription>
            Notes that this card is stored on a platform. It does not add the card to that
            platform — do that on the platform itself.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="Platform" required htmlFor="link-platform">
            <Select
              id="link-platform"
              value={platformId}
              onChange={(e) => setPlatformId(e.target.value)}
            >
              <option value="">Select a platform…</option>
              {platforms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Responsible person" htmlFor="link-owner">
            <Select
              id="link-owner"
              value={responsibleId}
              onChange={(e) => setResponsibleId(e.target.value)}
            >
              <option value="">Me</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" htmlFor="link-notes">
            <Textarea
              id="link-notes"
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
          <Button onClick={handleSubmit} loading={busy} disabled={!platformId}>
            Record link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MarkRemovedDialog({
  target,
  onClose,
}: {
  target: { linkId: string; cardName: string; platformName: string } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [removedAt, setRemovedAt] = React.useState(toDateInput(new Date()));
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function handleSubmit() {
    if (!target) return;
    setBusy(true);
    try {
      const result = await markLinkRemoved({
        id: target.linkId,
        removedAt,
        notes: notes || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Recorded as removed in this inventory');
      setNotes('');
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Mark {target?.cardName} removed from {target?.platformName}
          </DialogTitle>
          <DialogDescription>
            This records the removal in Nexora OS with an audit entry. It does{' '}
            <strong>not</strong> remove the card from {target?.platformName} — do that on the
            platform, then record it here.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="Removed on" required htmlFor="removed-at">
            <Input
              id="removed-at"
              type="date"
              value={removedAt}
              onChange={(e) => setRemovedAt(e.target.value)}
            />
          </Field>
          <Field label="Notes" htmlFor="removed-notes">
            <Textarea
              id="removed-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Who removed it, and how it was confirmed…"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleSubmit} loading={busy}>
            Record removal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
