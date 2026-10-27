'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { setClientArchived } from './actions';

/** Archive / restore control. Archiving is confirmed, never one click. */
export function ClientArchiveButton({
  clientId,
  clientName,
  archived,
}: {
  clientId: string;
  clientName: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  async function handleConfirm() {
    const result = await setClientArchived({ id: clientId, archived: !archived });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(archived ? 'Client restored' : 'Client archived');
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant={archived ? 'secondary' : 'danger-outline'} onClick={() => setOpen(true)}>
        {archived ? <ArchiveRestore /> : <Archive />}
        {archived ? 'Restore' : 'Archive'}
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone={archived ? 'default' : 'danger'}
        title={archived ? `Restore ${clientName}?` : `Archive ${clientName}?`}
        description={
          archived
            ? 'The client becomes active again and reappears in default list views.'
            : 'The client is hidden from default lists. Projects, invoices and payments are kept intact and nothing is deleted.'
        }
        confirmLabel={archived ? 'Restore client' : 'Archive client'}
        onConfirm={handleConfirm}
      />
    </>
  );
}
