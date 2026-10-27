'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
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
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Callout } from '@/components/ui/empty-state';
import { CARD_BRANDS, CARD_STATUSES } from './schemas';
import { createCard, updateCard } from './actions';

const BRAND_LABELS: Record<string, string> = {
  VISA: 'Visa',
  MASTERCARD: 'Mastercard',
  AMEX: 'American Express',
  DISCOVER: 'Discover',
  UNIONPAY: 'UnionPay',
  JCB: 'JCB',
  OTHER: 'Other',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  BLOCKED: 'Blocked',
  CANCELLED: 'Cancelled',
};

export interface CardFormCard {
  id: string;
  nickname: string;
  issuer: string;
  brand: string;
  last4: string;
  expiryMonth: number | null;
  expiryYear: number | null;
  status: string;
  notes: string | null;
  owner: { id: string; name: string } | null;
}

/**
 * Add or edit a card in the inventory.
 *
 * The form intentionally offers no field for a full card number, CVV or PIN.
 * `last4` accepts exactly four digits; the server schema and a database CHECK
 * constraint both enforce the same rule.
 */
export function CardFormDialog({
  open,
  onOpenChange,
  card,
  members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: CardFormCard | null;
  members: { id: string; name: string }[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <CardFormBody
          key={card?.id ?? 'new'}
          card={card}
          members={members}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function CardFormBody({
  card,
  members,
  onClose,
}: {
  card: CardFormCard | null;
  members: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const isEdit = Boolean(card);

  const [nickname, setNickname] = React.useState(card?.nickname ?? '');
  const [issuer, setIssuer] = React.useState(card?.issuer ?? '');
  const [brand, setBrand] = React.useState(card?.brand ?? 'OTHER');
  const [last4, setLast4] = React.useState(card?.last4 ?? '');
  const [expiryMonth, setExpiryMonth] = React.useState(card?.expiryMonth?.toString() ?? '');
  const [expiryYear, setExpiryYear] = React.useState(card?.expiryYear?.toString() ?? '');
  const [ownerId, setOwnerId] = React.useState(card?.owner?.id ?? '');
  const [status, setStatus] = React.useState(card?.status ?? 'ACTIVE');
  const [notes, setNotes] = React.useState(card?.notes ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const last4Valid = /^\d{4}$/.test(last4);
  const canSubmit = nickname.trim() && issuer.trim() && last4Valid;

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      const payload = {
        nickname: nickname.trim(),
        issuer: issuer.trim(),
        brand: brand as (typeof CARD_BRANDS)[number],
        last4,
        expiryMonth: expiryMonth === '' ? ('' as const) : Number(expiryMonth),
        expiryYear: expiryYear === '' ? ('' as const) : Number(expiryYear),
        ownerId: ownerId || null,
        status: status as (typeof CARD_STATUSES)[number],
        notes: notes || null,
      };

      const result = isEdit
        ? await updateCard({ id: card!.id, data: payload })
        : await createCard(payload);

      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(isEdit ? 'Card updated' : 'Card added to the inventory');
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const currentYear = new Date().getUTCFullYear();

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit card' : 'Add a card'}</DialogTitle>
        <DialogDescription>
          Tracks where a card is saved and what it pays for.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4">
        {error ? <Callout tone="danger">{error}</Callout> : null}

        <Callout tone="success">
          <span className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Only the last four digits are stored. There is no field here for the full card
              number, CVV or PIN — and the database refuses to hold one.
            </span>
          </span>
        </Callout>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nickname" required htmlFor="card-nickname" hint="How the office refers to it">
            <Input
              id="card-nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Office Visa"
              autoFocus
            />
          </Field>

          <Field label="Issuing bank" required htmlFor="card-issuer">
            <Input
              id="card-issuer"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="Meezan Bank"
            />
          </Field>

          <Field label="Brand" htmlFor="card-brand">
            <Select id="card-brand" value={brand} onChange={(e) => setBrand(e.target.value)}>
              {CARD_BRANDS.map((b) => (
                <option key={b} value={b}>
                  {BRAND_LABELS[b]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Last four digits"
            required
            htmlFor="card-last4"
            error={last4 && !last4Valid ? 'Enter exactly four digits.' : undefined}
            hint="Never enter the full card number."
          >
            <Input
              id="card-last4"
              inputMode="numeric"
              maxLength={4}
              autoComplete="off"
              value={last4}
              onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="4242"
              className="font-mono tabular"
            />
          </Field>

          <Field label="Expiry month" htmlFor="card-exp-month">
            <Select
              id="card-exp-month"
              value={expiryMonth}
              onChange={(e) => setExpiryMonth(e.target.value)}
            >
              <option value="">—</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {String(m).padStart(2, '0')}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Expiry year" htmlFor="card-exp-year">
            <Select
              id="card-exp-year"
              value={expiryYear}
              onChange={(e) => setExpiryYear(e.target.value)}
            >
              <option value="">—</option>
              {Array.from({ length: 16 }, (_, i) => currentYear - 1 + i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Held by" htmlFor="card-owner">
            <Select id="card-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Status" htmlFor="card-status">
            <Select id="card-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {CARD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Notes" htmlFor="card-notes">
          <Textarea
            id="card-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Spending limit, who approves charges…"
          />
        </Field>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} loading={busy} disabled={!canSubmit}>
          {isEdit ? 'Save changes' : 'Add card'}
        </Button>
      </DialogFooter>
    </>
  );
}
