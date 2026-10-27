'use client';

import * as React from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { AlertTriangle } from 'lucide-react';
import { Button } from './button';
import { Input, Label } from './field';
import { cn } from '@/lib/utils';

/**
 * Confirmation dialog for destructive and financially significant actions.
 *
 * Two levels of friction:
 *  • `tone="danger"` — an explicit confirm step, so a destructive action is
 *    never one click away from a list row.
 *  • `confirmPhrase` — the user must type an exact phrase (an invoice number,
 *    a client name) before the action unlocks. Used for irreversible financial
 *    operations such as voiding an issued invoice.
 *
 * The body is a separate component so Radix unmounting it on close resets the
 * typed phrase naturally, with no effect-driven state reset.
 */

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  /** When set, the user must type this exact string to enable confirmation. */
  confirmPhrase?: string;
  confirmPhraseLabel?: React.ReactNode;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({ open, onOpenChange, ...rest }: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-[#0b1220]/50 backdrop-blur-[2px]" />
        <AlertDialog.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2',
            'border-line bg-surface-raised animate-in-fade rounded-xl border p-5 shadow-lg focus:outline-none',
          )}
        >
          <ConfirmDialogBody {...rest} />
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function ConfirmDialogBody({
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  confirmPhrase,
  confirmPhraseLabel,
  loading = false,
  onConfirm,
}: Omit<ConfirmDialogProps, 'open' | 'onOpenChange'>) {
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const inputId = React.useId();

  const phraseSatisfied = !confirmPhrase || typed.trim() === confirmPhrase;
  const disabled = loading || busy || !phraseSatisfied;

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex gap-3.5">
        {tone === 'danger' ? (
          <div className="bg-danger-soft text-danger flex size-9 shrink-0 items-center justify-center rounded-full">
            <AlertTriangle className="size-4.5" aria-hidden />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <AlertDialog.Title className="text-ink text-base font-semibold">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="text-ink-muted mt-1.5 text-sm">{description}</div>
          </AlertDialog.Description>

          {confirmPhrase ? (
            <div className="mt-4 space-y-1.5">
              <Label htmlFor={inputId}>
                {confirmPhraseLabel ?? (
                  <>
                    Type <span className="text-ink font-mono font-semibold">{confirmPhrase}</span>{' '}
                    to confirm
                  </>
                )}
              </Label>
              <Input
                id={inputId}
                value={typed}
                autoComplete="off"
                onChange={(e) => setTyped(e.target.value)}
                placeholder={confirmPhrase}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <AlertDialog.Cancel asChild>
          <Button variant="secondary" disabled={busy}>
            {cancelLabel}
          </Button>
        </AlertDialog.Cancel>
        <Button
          variant={tone === 'danger' ? 'danger' : 'primary'}
          disabled={disabled}
          loading={busy || loading}
          onClick={handleConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </>
  );
}

/**
 * Imperative form for list rows:
 *   const { confirm, element } = useConfirm();
 *   ... onClick={() => confirm({ title, description, onConfirm })}
 *   ... {element}
 */
export function useConfirm() {
  const [state, setState] = React.useState<Omit<
    ConfirmDialogProps,
    'open' | 'onOpenChange'
  > | null>(null);

  const element = state ? (
    <ConfirmDialog
      {...state}
      open
      onOpenChange={(next) => {
        if (!next) setState(null);
      }}
      onConfirm={async () => {
        await state.onConfirm();
        setState(null);
      }}
    />
  ) : null;

  return { confirm: setState, element };
}
