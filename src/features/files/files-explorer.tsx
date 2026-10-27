'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Download,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderPlus,
  History,
  Image as ImageIcon,
  RotateCcw,
  Table2,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/field';
import { Checkbox, Tooltip } from '@/components/ui/misc';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { type Column, DataTable, SearchInput, TableToolbar } from '@/components/shared/data-table';
import { Avatar } from '@/components/ui/misc';
import { FileUploader } from './file-uploader';
import { createFolder, deleteFile, restoreFile } from './actions';
import type { FileFilters, FileListRow } from './queries';
import type { PaginatedResult } from '@/lib/query';
import { formatDate } from '@/lib/dates';
import { cn, formatBytes, withSearchParams } from '@/lib/utils';

interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  contextLabel: string | null;
  fileCount: number;
}

const SPREADSHEET_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

function iconFor(name: string) {
  const lower = name.toLowerCase();
  if (SPREADSHEET_EXTENSIONS.some((ext) => lower.endsWith(ext))) return FileSpreadsheet;
  if (/\.(png|jpe?g|webp)$/.test(lower)) return ImageIcon;
  return FileText;
}

function isImportable(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.csv') || lower.endsWith('.xlsx');
}

/** Files list with folder sidebar, uploader and per-file actions. */
export function FilesExplorer({
  data,
  filters,
  folders,
  categories,
  clients,
  maxUploadBytes,
  permissions,
}: {
  data: PaginatedResult<FileListRow>;
  filters: FileFilters;
  folders: FolderNode[];
  categories: string[];
  clients: { id: string; name: string }[];
  maxUploadBytes: number;
  permissions: {
    upload: boolean;
    update: boolean;
    delete: boolean;
    download: boolean;
    importData: boolean;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<FileListRow | null>(null);

  const update = React.useCallback(
    (changes: Record<string, string | number | null | undefined>, resetPage = true) => {
      const next = withSearchParams(searchParams, {
        ...changes,
        ...(resetPage ? { page: null } : {}),
      });
      startTransition(() => router.push(`${pathname}${next}`, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  async function handleDelete() {
    if (!deleteTarget) return;
    const result = await deleteFile({ id: deleteTarget.id, purge: false });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('File moved to the deleted list', {
      description: 'It can be restored from "Show deleted".',
    });
    setDeleteTarget(null);
    router.refresh();
  }

  async function handleRestore(file: FileListRow) {
    const result = await restoreFile({ id: file.id });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('File restored');
    router.refresh();
  }

  const columns: Column<FileListRow>[] = [
    {
      id: 'name',
      header: 'File',
      cell: (row) => {
        const Icon = iconFor(row.originalName);
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <Icon className="text-ink-subtle size-4 shrink-0" aria-hidden />
            <div className="min-w-0">
              <span
                className={cn(
                  'text-ink block truncate font-medium',
                  row.deletedAt && 'text-ink-subtle line-through',
                )}
              >
                {row.originalName}
              </span>
              <span className="text-ink-subtle flex flex-wrap items-center gap-1.5 text-xs">
                {formatBytes(row.byteSize)}
                {row.version > 1 ? (
                  <Tooltip content={`Version ${row.version} of this file`}>
                    <Badge tone="info" size="sm">
                      <History className="size-2.5" aria-hidden /> v{row.version}
                    </Badge>
                  </Tooltip>
                ) : null}
                {row.hasNewerVersion ? (
                  <Badge tone="outline" size="sm">
                    superseded
                  </Badge>
                ) : null}
                {row.isSystem ? (
                  <Badge tone="outline" size="sm">
                    generated
                  </Badge>
                ) : null}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      id: 'attachedTo',
      header: 'Attached to',
      cell: (row) =>
        row.client || row.project ? (
          <div className="min-w-0 text-[13px]">
            {row.client ? (
              <Link
                href={`/clients/${row.client.id}`}
                className="text-brand-500 block truncate hover:underline"
              >
                {row.client.name}
              </Link>
            ) : null}
            {row.project ? (
              <Link
                href={`/projects/${row.project.id}`}
                className="text-ink-muted hover:text-brand-500 block truncate hover:underline"
              >
                {row.project.name}
              </Link>
            ) : null}
          </div>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      id: 'category',
      header: 'Category',
      cell: (row) =>
        row.category ? (
          <Badge tone="outline">{row.category}</Badge>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      id: 'scan',
      header: 'Checks',
      cell: (row) => (
        <Tooltip
          content={
            row.scanStatus === 'SKIPPED'
              ? 'Extension, declared type and file signature were verified. No malware scanner is configured.'
              : `Scan status: ${row.scanStatus.toLowerCase()}`
          }
        >
          <span>
            <Badge tone={row.scanStatus === 'INFECTED' ? 'danger' : 'neutral'} size="sm">
              {row.scanStatus === 'SKIPPED' ? 'type verified' : row.scanStatus.toLowerCase()}
            </Badge>
          </span>
        </Tooltip>
      ),
    },
    {
      id: 'uploadedBy',
      header: 'Uploaded by',
      cell: (row) => (
        <span className="text-ink-muted flex items-center gap-1.5 text-[13px]">
          <Avatar name={row.uploadedBy.name} color={row.uploadedBy.avatarColor} size="xs" />
          <span className="truncate">{row.uploadedBy.name}</span>
        </span>
      ),
    },
    {
      id: 'createdAt',
      header: 'Added',
      cell: (row) => <span className="text-ink-muted">{formatDate(row.createdAt)}</span>,
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      hideOnMobile: false,
      mobileLabel: 'Actions',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          {permissions.importData && isImportable(row.originalName) && !row.deletedAt ? (
            <Tooltip content="Preview and import this spreadsheet as client records">
              <Button
                variant="ghost"
                size="icon-sm"
                asChild
                aria-label={`Import ${row.originalName}`}
              >
                <Link href={`/clients/import?fileId=${row.id}`}>
                  <Table2 />
                </Link>
              </Button>
            </Tooltip>
          ) : null}
          {permissions.download && !row.deletedAt ? (
            <Tooltip content="Download">
              <Button
                variant="ghost"
                size="icon-sm"
                asChild
                aria-label={`Download ${row.originalName}`}
              >
                <a href={`/api/files/${row.id}/download`}>
                  <Download />
                </a>
              </Button>
            </Tooltip>
          ) : null}
          {permissions.delete && row.deletedAt ? (
            <Tooltip content="Restore">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Restore ${row.originalName}`}
                onClick={() => handleRestore(row)}
              >
                <RotateCcw />
              </Button>
            </Tooltip>
          ) : null}
          {permissions.delete && !row.deletedAt && !row.isSystem ? (
            <Tooltip content="Delete">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${row.originalName}`}
                onClick={() => setDeleteTarget(row)}
              >
                <Trash2 className="text-danger" />
              </Button>
            </Tooltip>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[14rem_1fr]">
      <aside className="space-y-3">
        {permissions.upload ? (
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={() => setFolderDialogOpen(true)}
          >
            <FolderPlus /> New folder
          </Button>
        ) : null}

        <nav aria-label="Folders">
          <button
            type="button"
            onClick={() => update({ folderId: null })}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors',
              !filters.folderId
                ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300 font-medium'
                : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
            )}
          >
            <Folder className="size-3.5 shrink-0" aria-hidden />
            All files
            <span className="tabular text-ink-subtle ml-auto text-[11px]">{data.total}</span>
          </button>

          <ul className="mt-0.5 space-y-0.5">
            {folders.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  onClick={() => update({ folderId: folder.id })}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors',
                    filters.folderId === folder.id
                      ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300 font-medium'
                      : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
                  )}
                >
                  <Folder className="size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {folder.name}
                    {folder.contextLabel ? (
                      <span className="text-ink-subtle block truncate text-[10px]">
                        {folder.contextLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular text-ink-subtle text-[11px]">{folder.fileCount}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="min-w-0 space-y-4">
        {permissions.upload ? (
          <FileUploader
            maxBytes={maxUploadBytes}
            folderId={filters.folderId || null}
            clientId={filters.clientId || null}
            projectId={filters.projectId || null}
            compact
          />
        ) : null}

        <DataTable
          columns={columns}
          rows={data.rows}
          rowKey={(row) => row.id}
          loading={pending}
          caption="Files"
          emptyTitle={filters.search ? 'No files match' : 'No files yet'}
          emptyDescription={
            filters.search
              ? 'Try a different search term.'
              : 'Upload spreadsheets, contracts and documents to keep them with the client and project they belong to.'
          }
          pagination={{
            page: data.page,
            pageSize: data.pageSize,
            total: data.total,
            onPageChange: (page) => update({ page }, false),
            onPageSizeChange: (pageSize) => update({ pageSize }),
          }}
          toolbar={
            <TableToolbar>
              <SearchInput
                value={filters.search}
                onChange={(value) => update({ search: value })}
                placeholder="Search file names…"
                className="w-full sm:w-56"
              />

              <Select
                aria-label="Filter by client"
                value={filters.clientId}
                onChange={(e) => update({ clientId: e.target.value || null })}
                className="h-9 w-auto max-w-44"
              >
                <option value="">All clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>

              {categories.length > 0 ? (
                <Select
                  aria-label="Filter by category"
                  value={filters.category}
                  onChange={(e) => update({ category: e.target.value || null })}
                  className="h-9 w-auto max-w-40"
                >
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              ) : null}

              <label className="text-ink-muted flex cursor-pointer items-center gap-1.5 text-[13px]">
                <Checkbox
                  checked={filters.spreadsheetsOnly}
                  onCheckedChange={(checked) => update({ spreadsheetsOnly: checked ? '1' : null })}
                />
                Spreadsheets only
              </label>

              {permissions.delete ? (
                <label className="text-ink-muted flex cursor-pointer items-center gap-1.5 text-[13px]">
                  <Checkbox
                    checked={filters.includeDeleted}
                    onCheckedChange={(checked) => update({ includeDeleted: checked ? '1' : null })}
                  />
                  Show deleted
                </label>
              ) : null}
            </TableToolbar>
          }
        />
      </div>

      <NewFolderDialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget?.originalName ?? 'this file'}?`}
        description="The file is moved to the deleted list and hidden from the default view. The stored copy is kept so it can be restored."
        confirmLabel="Delete file"
        onConfirm={handleDelete}
      />
    </div>
  );
}

function NewFolderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function handleSubmit() {
    setBusy(true);
    try {
      const result = await createFolder({ name: name.trim(), parentId: null });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Folder created');
      setName('');
      onOpenChange(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <label className="block">
            <span className="text-ink text-[13px] font-medium">Folder name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="Contracts"
              className="mt-1.5"
              autoFocus
            />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={busy} disabled={!name.trim()}>
            Create folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
