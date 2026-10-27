'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Ban,
  Download,
  FileCheck2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Field, Input, Textarea } from '@/components/ui/field';
import { Checkbox } from '@/components/ui/misc';
import { Callout } from '@/components/ui/empty-state';
import {
  deleteDraftInvoice,
  issueInvoice,
  regenerateInvoicePdf,
  sendInvoice,
  voidInvoice,
} from './actions';

/**
 * Invoice action bar.
 *
 * Every state transition that cannot be undone — issue, send, void, delete —
 * goes through an explicit confirmation. Voiding additionally requires typing
 * the invoice number, because it permanently retires a numbered document.
 */
export function InvoiceActionsBar({
  invoiceId,
  invoiceNumber,
  status,
  clientEmail,
  hasPdf,
  permissions,
}: {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  clientEmail: string | null;
  hasPdf: boolean;
  permissions: {
    update: boolean;
    issue: boolean;
    send: boolean;
    void: boolean;
    delete: boolean;
    downloadPdf: boolean;
    recordPayment: boolean;
  };
}) {
  const router = useRouter();
  const [issueOpen, setIssueOpen] = React.useState(false);
  const [sendOpen, setSendOpen] = React.useState(false);
  const [voidOpen, setVoidOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const isDraft = status === 'DRAFT';
  const isClosed = status === 'VOID' || status === 'CANCELLED';
  const isIssued = !isDraft && !isClosed;

  async function handleIssue() {
    setBusy(true);
    try {
      const result = await issueInvoice({ id: invoiceId, generatePdf: true });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.invoiceNumber} issued`);
      setIssueOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRegeneratePdf() {
    const result = await regenerateInvoicePdf({ id: invoiceId });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('PDF regenerated');
    router.refresh();
  }

  async function handleDelete() {
    const result = await deleteDraftInvoice({ id: invoiceId });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Draft deleted');
    router.push('/invoices');
    router.refresh();
  }

  return (
    <>
      {permissions.recordPayment && isIssued ? (
        <Button asChild variant="secondary">
          <Link href={`/invoices/${invoiceId}?payment=1`}>
            <Wallet /> Record payment
          </Link>
        </Button>
      ) : null}

      {permissions.downloadPdf && hasPdf ? (
        <Button variant="secondary" asChild>
          <a href={`/api/invoices/${invoiceId}/pdf`} target="_blank" rel="noopener noreferrer">
            <Download /> PDF
          </a>
        </Button>
      ) : null}

      {permissions.update && isDraft ? (
        <Button variant="secondary" asChild>
          <Link href={`/invoices/${invoiceId}/edit`}>
            <Pencil /> Edit
          </Link>
        </Button>
      ) : null}

      {permissions.issue && isDraft ? (
        <Button onClick={() => setIssueOpen(true)}>
          <FileCheck2 /> Issue invoice
        </Button>
      ) : null}

      {permissions.send && isIssued ? (
        <Button onClick={() => setSendOpen(true)}>
          <Send /> Send
        </Button>
      ) : null}

      {(permissions.void && isIssued) ||
      (permissions.delete && isDraft) ||
      (permissions.downloadPdf && !isDraft) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon" aria-label="More actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {permissions.downloadPdf && !isDraft ? (
              <DropdownMenuItem onSelect={handleRegeneratePdf}>
                <RefreshCw /> Regenerate PDF
              </DropdownMenuItem>
            ) : null}
            {permissions.void && isIssued ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => setVoidOpen(true)}>
                  <Ban /> Void invoice
                </DropdownMenuItem>
              </>
            ) : null}
            {permissions.delete && isDraft ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => setDeleteOpen(true)}>
                  <Trash2 /> Delete draft
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <ConfirmDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        tone="default"
        title={`Issue ${invoiceNumber}?`}
        description={
          <>
            Issuing freezes the amounts and captures a permanent snapshot of the client&rsquo;s
            billing details. After this the invoice can no longer be edited — corrections are made
            with a credit note or a replacement invoice. A branded PDF is generated.
          </>
        }
        confirmLabel="Issue invoice"
        loading={busy}
        onConfirm={handleIssue}
      />

      <SendInvoiceDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        invoiceId={invoiceId}
        invoiceNumber={invoiceNumber}
        clientEmail={clientEmail}
      />

      <VoidInvoiceDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        invoiceId={invoiceId}
        invoiceNumber={invoiceNumber}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete draft ${invoiceNumber}?`}
        description="The draft and its line items are permanently removed. Only drafts can be deleted; issued invoices are voided so the number sequence stays auditable."
        confirmLabel="Delete draft"
        onConfirm={handleDelete}
      />
    </>
  );
}

function SendInvoiceDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  clientEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
  clientEmail: string | null;
}) {
  const router = useRouter();
  const [recipient, setRecipient] = React.useState(clientEmail ?? '');
  const [message, setMessage] = React.useState('');
  const [markOnly, setMarkOnly] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function handleSend() {
    setBusy(true);
    try {
      const result = await sendInvoice({
        id: invoiceId,
        recipientEmail: recipient || null,
        message: message || null,
        markOnly,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Report exactly what happened — never imply delivery that did not occur.
      if (result.data.delivery === 'sent') {
        toast.success('Invoice emailed', { description: result.data.note });
      } else {
        toast.warning('Recorded as sent', { description: result.data.note });
      }
      onOpenChange(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send {invoiceNumber}</DialogTitle>
          <DialogDescription>
            Email the invoice to the client, or just record that it was sent by other means.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Callout tone="info">
            Marking an invoice sent records the fact only. It never implies the client has paid.
          </Callout>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-2.5">
            <Checkbox
              checked={markOnly}
              onCheckedChange={(checked) => setMarkOnly(checked === true)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-[13px] font-medium text-ink">
                Mark as sent without emailing
              </span>
              <span className="block text-xs text-ink-subtle">
                Use this when the invoice was delivered by hand, post or another system.
              </span>
            </span>
          </label>

          {!markOnly ? (
            <>
              <Field
                label="Recipient"
                htmlFor="recipient"
                hint={clientEmail ? `Defaults to the client's billing email.` : 'This client has no billing email on file.'}
              >
                <Input
                  id="recipient"
                  type="email"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="accounts@client.com"
                />
              </Field>
              <Field label="Message" htmlFor="send-message">
                <Textarea
                  id="send-message"
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Optional covering note…"
                />
              </Field>
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend} loading={busy}>
            {markOnly ? 'Mark as sent' : 'Send invoice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidInvoiceDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
}) {
  const router = useRouter();
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function handleVoid() {
    setBusy(true);
    try {
      const result = await voidInvoice({ id: invoiceId, reason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${invoiceNumber} voided`);
      onOpenChange(false);
      setReason('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void {invoiceNumber}</DialogTitle>
          <DialogDescription>
            The invoice stays in the record with its number intact, marked void. This cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Callout tone="warning">
            An invoice with payments against it cannot be voided — issue a credit note instead so
            the payment history is preserved.
          </Callout>
          <Field label="Reason" required htmlFor="void-reason">
            <Textarea
              id="void-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this invoice being voided?"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleVoid} loading={busy} disabled={reason.trim().length < 3}>
            Void invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
