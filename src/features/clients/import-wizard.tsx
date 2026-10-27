'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { Callout, EmptyState } from '@/components/ui/empty-state';
import { Checkbox } from '@/components/ui/misc';
import { FileUploader } from '@/features/files/file-uploader';
import {
  commitClientImport,
  previewClientImport,
  validateClientImport,
  type ImportPreview,
  type ImportValidation,
} from './import';
import { cn } from '@/lib/utils';

type Step = 'choose' | 'map' | 'review' | 'done';

/**
 * Client import wizard.
 *
 * Deliberately four explicit steps — choose, map, review, confirm — because
 * a silent bulk insert from a spreadsheet is how duplicate and malformed
 * client records get into a CRM. Nothing is written until the final step,
 * and the review screen shows every row-level error first.
 */
export function ClientImportWizard({
  initialFileId,
  spreadsheets,
  maxUploadBytes,
}: {
  initialFileId: string | null;
  spreadsheets: { id: string; originalName: string; createdAt: Date }[];
  maxUploadBytes: number;
}) {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>(initialFileId ? 'map' : 'choose');
  const [fileId, setFileId] = React.useState<string | null>(initialFileId);
  const [sheetName, setSheetName] = React.useState<string | undefined>(undefined);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, string | null>>({});
  const [validation, setValidation] = React.useState<ImportValidation | null>(null);
  const [includeDuplicates, setIncludeDuplicates] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{
    imported: number;
    skippedInvalid: number;
    skippedDuplicates: number;
  } | null>(null);

  const loadPreview = React.useCallback(
    async (targetFileId: string, targetSheet?: string) => {
      setBusy(true);
      setError(null);
      try {
        const response = await previewClientImport({ fileId: targetFileId, sheetName: targetSheet });
        if (!response.ok) {
          setError(response.error);
          return;
        }
        setPreview(response.data);
        setMapping(response.data.suggestedMapping);
        setSheetName(response.data.sheet.name);
        setStep('map');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // Load the preview when arriving with a file already chosen.
  const [primedFileId, setPrimedFileId] = React.useState<string | null>(null);
  if (fileId && fileId !== primedFileId && !preview && !busy) {
    setPrimedFileId(fileId);
    void loadPreview(fileId);
  }

  async function handleValidate() {
    if (!fileId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await validateClientImport({ fileId, sheetName, mapping });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setValidation(response.data);
      setStep('review');
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    if (!fileId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await commitClientImport({
        fileId,
        sheetName,
        mapping,
        includeDuplicates,
      });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setResult(response.data);
      setStep('done');
      toast.success(`${response.data.imported} client(s) imported`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const mappedFields = new Set(Object.values(mapping).filter(Boolean) as string[]);
  const nameMapped = mappedFields.has('name');

  return (
    <div className="space-y-5">
      <Steps current={step} />

      {error ? <Callout tone="danger">{error}</Callout> : null}

      {step === 'choose' ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Choose a spreadsheet</CardTitle>
              <p className="mt-0.5 text-xs text-ink-subtle">
                Upload a new CSV or XLSX file, or pick one already in Sheets &amp; Files.
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <FileUploader
              maxBytes={maxUploadBytes}
              accept=".csv,.xlsx"
              category="Import"
              compact
              onUploaded={(outcome) => {
                const first = outcome.uploaded[0];
                if (first) {
                  setFileId(first.id);
                  setPrimedFileId(first.id);
                  void loadPreview(first.id);
                }
              }}
            />

            {spreadsheets.length > 0 ? (
              <div>
                <p className="mb-1.5 text-[13px] font-medium text-ink">Or choose an existing file</p>
                <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-lg border border-line">
                  {spreadsheets.map((file) => (
                    <li key={file.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setFileId(file.id);
                          setPrimedFileId(file.id);
                          void loadPreview(file.id);
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
                      >
                        <Table2 className="size-4 shrink-0 text-ink-subtle" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">
                          {file.originalName}
                        </span>
                        <ArrowRight className="size-3.5 text-ink-subtle" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step === 'map' && preview ? (
        <>
          {preview.warnings.length > 0 ? (
            <Callout tone="warning">
              <ul className="space-y-0.5">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Callout>
          ) : null}

          {preview.sheetNames.length > 1 ? (
            <Card>
              <CardContent className="flex items-center gap-3 pt-4">
                <span className="text-[13px] font-medium text-ink">Sheet</span>
                <Select
                  aria-label="Choose a sheet"
                  value={sheetName ?? ''}
                  onChange={(e) => {
                    setSheetName(e.target.value);
                    if (fileId) void loadPreview(fileId, e.target.value);
                  }}
                  className="w-auto"
                >
                  {preview.sheetNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Map the columns</CardTitle>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  {preview.sheet.rowCount} data row{preview.sheet.rowCount === 1 ? '' : 's'} found.
                  Columns left unmapped are ignored.
                </p>
              </div>
            </CardHeader>
            <CardContent>
              {!nameMapped ? (
                <Callout tone="warning" className="mb-3">
                  Map a column to <strong>Name</strong> — it is the only required field.
                </Callout>
              ) : null}

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Column mapping and sample data</caption>
                  <thead>
                    <tr className="border-b border-line">
                      <th scope="col" className="py-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                        Spreadsheet column
                      </th>
                      <th scope="col" className="py-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                        Import as
                      </th>
                      <th scope="col" className="py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                        Sample values
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sheet.headers.map((header, columnIndex) => {
                      const selected = mapping[header] ?? '';
                      const samples = preview.sheet.rows
                        .slice(0, 3)
                        .map((row) => row[columnIndex])
                        .filter((v) => v && v.trim() !== '');

                      return (
                        <tr key={header} className="border-b border-line last:border-0">
                          <td className="py-2 pr-4 font-medium text-ink">{header}</td>
                          <td className="py-2 pr-4">
                            <Select
                              aria-label={`Import "${header}" as`}
                              value={selected}
                              onChange={(e) =>
                                setMapping((current) => ({
                                  ...current,
                                  [header]: e.target.value || null,
                                }))
                              }
                              className="h-8 w-auto min-w-44 text-[13px]"
                            >
                              <option value="">Ignore this column</option>
                              {preview.fields.map((field) => (
                                <option
                                  key={field.key}
                                  value={field.key}
                                  disabled={mappedFields.has(field.key) && selected !== field.key}
                                >
                                  {field.label}
                                  {field.required ? ' *' : ''}
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className="py-2 text-xs text-ink-subtle">
                            {samples.length > 0 ? samples.join(' · ') : <span>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep('choose')}>
              <ArrowLeft /> Choose a different file
            </Button>
            <Button onClick={handleValidate} loading={busy} disabled={!nameMapped}>
              Check the rows <ArrowRight />
            </Button>
          </div>
        </>
      ) : null}

      {step === 'review' && validation ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryTile
              label="Rows read"
              value={validation.totalRows}
              note={validation.truncated ? 'File truncated to the row limit' : undefined}
            />
            <SummaryTile label="Valid" value={validation.validRows} tone="success" />
            <SummaryTile
              label="Rows with errors"
              value={new Set(validation.errors.map((e) => e.row)).size}
              tone={validation.errors.length > 0 ? 'danger' : undefined}
            />
          </div>

          {validation.errors.length > 0 ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Rows that will be skipped</CardTitle>
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    Fix these in the spreadsheet and re-upload if you need them.
                  </p>
                </div>
              </CardHeader>
              <CardContent className="max-h-72 overflow-y-auto">
                <ul className="divide-y divide-[var(--line)] text-sm">
                  {validation.errors.slice(0, 200).map((rowError, index) => (
                    <li key={`${rowError.row}-${rowError.field}-${index}`} className="flex gap-3 py-2">
                      <span className="w-16 shrink-0 tabular text-ink-subtle">Row {rowError.row}</span>
                      <span className="w-28 shrink-0 font-medium text-ink">{rowError.field}</span>
                      <span className="min-w-0 flex-1 text-ink-muted">
                        {rowError.message}
                        {rowError.value ? (
                          <span className="ml-1 font-mono text-xs text-ink-subtle">
                            ({rowError.value})
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
                {validation.errors.length > 200 ? (
                  <p className="pt-2 text-xs text-ink-subtle">
                    …and {validation.errors.length - 200} more.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {validation.duplicates.length > 0 ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Possible duplicates</CardTitle>
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    These rows match a client that already exists, by name or email.
                  </p>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                  {validation.duplicates.slice(0, 50).map((dup) => (
                    <li key={`${dup.row}-${dup.existingId}`} className="flex gap-3">
                      <span className="w-16 shrink-0 tabular text-ink-subtle">Row {dup.row}</span>
                      <span className="text-ink">{dup.name}</span>
                    </li>
                  ))}
                </ul>

                <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-2.5">
                  <Checkbox
                    checked={includeDuplicates}
                    onCheckedChange={(checked) => setIncludeDuplicates(checked === true)}
                    className="mt-0.5"
                  />
                  <span className="text-[13px] text-ink">
                    Create these anyway
                    <span className="block text-xs text-ink-subtle">
                      Leave unticked to skip them. They are never merged automatically.
                    </span>
                  </span>
                </label>
              </CardContent>
            </Card>
          ) : null}

          {validation.validRows === 0 ? (
            <Callout tone="danger">
              No row passed validation, so there is nothing to import.
            </Callout>
          ) : (
            <Callout tone="info">
              <strong>
                {includeDuplicates
                  ? validation.validRows
                  : validation.validRows - validation.duplicates.length}
              </strong>{' '}
              client{' '}
              {(includeDuplicates
                ? validation.validRows
                : validation.validRows - validation.duplicates.length) === 1
                ? 'record'
                : 'records'}{' '}
              will be created. Nothing has been written yet.
            </Callout>
          )}

          <div className="flex justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep('map')}>
              <ArrowLeft /> Back to mapping
            </Button>
            <Button onClick={handleCommit} loading={busy} disabled={validation.validRows === 0}>
              Import clients
            </Button>
          </div>
        </>
      ) : null}

      {step === 'done' && result ? (
        <EmptyState
          icon={CheckCircle2}
          title={`${result.imported} client${result.imported === 1 ? '' : 's'} imported`}
          description={
            <>
              {result.skippedInvalid > 0 ? (
                <span className="block">{result.skippedInvalid} row error(s) were skipped.</span>
              ) : null}
              {result.skippedDuplicates > 0 ? (
                <span className="block">
                  {result.skippedDuplicates} likely duplicate(s) were skipped.
                </span>
              ) : null}
              <span className="block">The original file is kept in Sheets &amp; Files.</span>
            </>
          }
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => router.push('/files')}>
                Back to files
              </Button>
              <Button onClick={() => router.push('/clients')}>View clients</Button>
            </div>
          }
        />
      ) : null}
    </div>
  );
}

function Steps({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'choose', label: 'Choose file' },
    { key: 'map', label: 'Map columns' },
    { key: 'review', label: 'Review errors' },
    { key: 'done', label: 'Import' },
  ];
  const currentIndex = steps.findIndex((s) => s.key === current);

  return (
    <ol className="flex flex-wrap items-center gap-2 text-[13px]">
      {steps.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'todo';
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full text-[11px] font-semibold',
                state === 'done' && 'bg-success text-white',
                state === 'active' && 'bg-brand-500 text-white',
                state === 'todo' && 'bg-surface-sunken text-ink-subtle',
              )}
              aria-hidden
            >
              {index + 1}
            </span>
            <span
              className={cn(
                state === 'active' ? 'font-medium text-ink' : 'text-ink-subtle',
              )}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              {step.label}
            </span>
            {index < steps.length - 1 ? (
              <span className="h-px w-5 bg-line" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function SummaryTile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: number;
  note?: string;
  tone?: 'success' | 'danger';
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <p className="text-xs text-ink-subtle">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-2xl font-semibold tabular',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger',
          !tone && 'text-ink',
        )}
      >
        {value}
      </p>
      {note ? (
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-warning">
          <AlertTriangle className="size-3" aria-hidden />
          {note}
        </p>
      ) : null}
    </div>
  );
}
