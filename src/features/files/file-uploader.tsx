'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, CloudUpload, FileWarning, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Callout } from '@/components/ui/empty-state';
import { uploadFiles, type UploadOutcome } from './actions';
import { cn, formatBytes } from '@/lib/utils';

/**
 * Drag-and-drop uploader.
 *
 * Files post to a server action, which validates extension, declared type,
 * size and magic bytes before anything reaches storage. Per-file rejections
 * are shown individually so one bad file does not discard a good batch.
 */
export function FileUploader({
  clientId,
  projectId,
  folderId,
  accept,
  category,
  maxBytes,
  compact,
  onUploaded,
}: {
  clientId?: string | null;
  projectId?: string | null;
  folderId?: string | null;
  accept?: string;
  /** Category stamped on every file in this batch. */
  category?: string;
  maxBytes: number;
  compact?: boolean;
  onUploaded?: (outcome: UploadOutcome) => void;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [rejected, setRejected] = React.useState<{ name: string; reason: string }[]>([]);
  const [succeeded, setSucceeded] = React.useState<string[]>([]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    setBusy(true);
    setRejected([]);
    setSucceeded([]);

    try {
      const formData = new FormData();
      for (const file of Array.from(fileList)) formData.append('files', file);
      if (clientId) formData.append('clientId', clientId);
      if (projectId) formData.append('projectId', projectId);
      if (folderId) formData.append('folderId', folderId);
      if (category) formData.append('category', category);

      const result = await uploadFiles(formData);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setRejected(result.data.rejected);
      setSucceeded(result.data.uploaded.map((f) => f.originalName));

      if (result.data.uploaded.length > 0) {
        toast.success(
          `${result.data.uploaded.length} file${result.data.uploaded.length === 1 ? '' : 's'} uploaded`,
          result.data.rejected.length > 0
            ? { description: `${result.data.rejected.length} were rejected.` }
            : undefined,
        );
      } else if (result.data.rejected.length > 0) {
        toast.error('No files were accepted.');
      }

      onUploaded?.(result.data);
      router.refresh();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'relative rounded-xl border-2 border-dashed text-center transition-colors',
          compact ? 'px-4 py-5' : 'px-6 py-9',
          dragging ? 'border-brand-500 bg-brand-500/5' : 'border-line bg-surface',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          onChange={(e) => void handleFiles(e.target.files)}
          disabled={busy}
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          aria-label="Choose files to upload"
        />

        <div className="pointer-events-none flex flex-col items-center gap-2">
          {busy ? (
            <Loader2 className="size-6 animate-spin text-brand-500" aria-hidden />
          ) : (
            <CloudUpload className="size-6 text-ink-subtle" aria-hidden />
          )}
          <p className="text-sm font-medium text-ink">
            {busy ? 'Uploading and checking files…' : 'Drop files here, or click to choose'}
          </p>
          <p className="text-xs text-ink-subtle">
            Spreadsheets, PDFs, documents and images up to {formatBytes(maxBytes)}. Each file is
            checked against its real contents, not just its name.
          </p>
        </div>
      </div>

      {succeeded.length > 0 ? (
        <Callout tone="success">
          <span className="flex items-start gap-1.5">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>Uploaded: {succeeded.join(', ')}</span>
          </span>
        </Callout>
      ) : null}

      {rejected.length > 0 ? (
        <Callout tone="danger" title="Some files were rejected">
          <ul className="mt-1 space-y-1">
            {rejected.map((item) => (
              <li key={item.name} className="flex items-start gap-1.5 text-xs">
                <FileWarning className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  <span className="font-medium">{item.name}</span> — {item.reason}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setRejected([])}
            className="mt-2 inline-flex items-center gap-1 text-xs text-ink-subtle hover:text-ink"
          >
            <X className="size-3" aria-hidden /> Dismiss
          </button>
        </Callout>
      ) : null}
    </div>
  );
}
