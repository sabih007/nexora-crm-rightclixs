'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { ActionError, defineAction } from '@/lib/action';
import { recordAudit } from '@/lib/audit';
import { getObject } from '@/lib/storage';
import {
  MAX_IMPORT_ROWS,
  MAX_PREVIEW_ROWS,
  mapAndValidateRows,
  parseSpreadsheet,
  suggestMapping,
  type RowError,
  type SheetData,
} from '@/features/files/spreadsheet';
import { getFileForProcessing } from '@/features/files/queries';
import { CLIENT_IMPORT_FIELDS } from './schemas';
import { normalizeName } from '@/lib/utils';
import { CURRENCY_REGEX } from '@/lib/money';

/**
 * Client spreadsheet import.
 *
 * Three explicit steps, matching the specification:
 *   1. `previewClientImport`  — read headers and the first rows, suggest a
 *                               column mapping. Writes nothing.
 *   2. `validateClientImport` — apply the mapping to every row and return the
 *                               full error list. Still writes nothing.
 *   3. `commitClientImport`   — only after the user confirms, insert the valid
 *                               rows in one transaction.
 *
 * The uploaded file is never modified and remains downloadable in its
 * original form.
 */

const fileIdSchema = z.object({ fileId: z.uuid(), sheetName: z.string().optional() });

export interface ImportPreview {
  sheetNames: string[];
  sheet: {
    name: string;
    headers: string[];
    rows: string[][];
    rowCount: number;
    truncated: boolean;
  };
  suggestedMapping: Record<string, string | null>;
  fields: { key: string; label: string; required: boolean }[];
  warnings: string[];
}

async function loadSheet(
  ctx: { workspaceId: string; role: string; user: { id: string } },
  fileId: string,
  sheetName: string | undefined,
  limit: number,
): Promise<{ sheet: SheetData; sheetNames: string[]; warnings: string[] }> {
  // `getFileForProcessing` applies the same scope rules as the file list, so
  // an import cannot be used to read a file the user could not download.
  const file = await getFileForProcessing(
    ctx as Parameters<typeof getFileForProcessing>[0],
    fileId,
  );
  if (!file) throw new ActionError('File not found.', { code: 'NOT_FOUND' });

  const lower = file.originalName.toLowerCase();
  if (!lower.endsWith('.csv') && !lower.endsWith('.xlsx')) {
    throw new ActionError('Only .csv and .xlsx files can be imported.', { code: 'UNSUPPORTED' });
  }

  const buffer = await getObject(file.storageKey);
  const parsed = await parseSpreadsheet(buffer, file.originalName, limit);

  const sheet = sheetName
    ? (parsed.sheets.find((s) => s.name === sheetName) ?? parsed.sheets[0])
    : parsed.sheets[0];

  if (!sheet) throw new ActionError('The file contains no readable sheet.', { code: 'EMPTY' });

  return { sheet, sheetNames: parsed.sheets.map((s) => s.name), warnings: parsed.warnings };
}

export const previewClientImport = defineAction({
  name: 'client.import_preview',
  permission: 'client:import',
  input: fileIdSchema,
  handler: async ({ input, ctx }): Promise<ImportPreview> => {
    const { sheet, sheetNames, warnings } = await loadSheet(
      ctx,
      input.fileId,
      input.sheetName,
      MAX_PREVIEW_ROWS,
    );

    return {
      sheetNames,
      sheet: {
        name: sheet.name,
        headers: sheet.headers,
        rows: sheet.rows,
        rowCount: sheet.rowCount,
        truncated: sheet.truncated,
      },
      suggestedMapping: suggestMapping(sheet.headers, CLIENT_IMPORT_FIELDS),
      fields: CLIENT_IMPORT_FIELDS.map((f) => ({ ...f })),
      warnings,
    };
  },
});

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

interface ParsedClientRow {
  name: string;
  type: 'COMPANY' | 'INDIVIDUAL';
  email: string | null;
  phone: string | null;
  website: string | null;
  billingCurrency: string;
  taxId: string | null;
  status: 'ACTIVE' | 'PROSPECT' | 'INACTIVE';
  address: Record<string, string>;
  tags: string[];
  notes: string | null;
}

function validateClientRow(
  record: Record<string, string>,
  defaultCurrency: string,
): { ok: true; data: ParsedClientRow } | { ok: false; errors: Omit<RowError, 'row'>[] } {
  const errors: Omit<RowError, 'row'>[] = [];

  const name = (record.name ?? '').trim();
  if (!name) {
    errors.push({ field: 'name', message: 'A client name is required.' });
  } else if (name.length > 200) {
    errors.push({ field: 'name', message: 'The name exceeds 200 characters.', value: name });
  }

  const rawEmail = (record.email ?? '').trim().toLowerCase();
  if (rawEmail && !z.email().safeParse(rawEmail).success) {
    errors.push({ field: 'email', message: 'Not a valid email address.', value: rawEmail });
  }

  const rawType = (record.type ?? '').trim().toUpperCase();
  let type: 'COMPANY' | 'INDIVIDUAL' = 'COMPANY';
  if (rawType) {
    if (rawType === 'COMPANY' || rawType === 'INDIVIDUAL') {
      type = rawType;
    } else {
      errors.push({
        field: 'type',
        message: 'Use COMPANY or INDIVIDUAL.',
        value: rawType,
      });
    }
  }

  const rawCurrency = (record.billingCurrency ?? '').trim().toUpperCase();
  let billingCurrency = defaultCurrency;
  if (rawCurrency) {
    if (CURRENCY_REGEX.test(rawCurrency)) {
      billingCurrency = rawCurrency;
    } else {
      errors.push({
        field: 'billingCurrency',
        message: 'Use a 3-letter ISO currency code.',
        value: rawCurrency,
      });
    }
  }

  const rawStatus = (record.status ?? '').trim().toUpperCase();
  let status: 'ACTIVE' | 'PROSPECT' | 'INACTIVE' = 'ACTIVE';
  if (rawStatus) {
    if (rawStatus === 'ACTIVE' || rawStatus === 'PROSPECT' || rawStatus === 'INACTIVE') {
      status = rawStatus;
    } else {
      errors.push({
        field: 'status',
        message: 'Use ACTIVE, PROSPECT or INACTIVE.',
        value: rawStatus,
      });
    }
  }

  const rawWebsite = (record.website ?? '').trim();
  let website: string | null = null;
  if (rawWebsite) {
    try {
      const url = new URL(rawWebsite.startsWith('http') ? rawWebsite : `https://${rawWebsite}`);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        website = rawWebsite;
      } else {
        errors.push({ field: 'website', message: 'Only http(s) addresses.', value: rawWebsite });
      }
    } catch {
      errors.push({ field: 'website', message: 'Not a valid web address.', value: rawWebsite });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const address: Record<string, string> = {};
  for (const [field, key] of [
    ['addressLine1', 'line1'],
    ['addressLine2', 'line2'],
    ['city', 'city'],
    ['state', 'state'],
    ['postalCode', 'postalCode'],
    ['country', 'country'],
  ] as const) {
    const value = (record[field] ?? '').trim();
    if (value) address[key] = value;
  }

  return {
    ok: true,
    data: {
      name,
      type,
      email: rawEmail || null,
      phone: (record.phone ?? '').trim() || null,
      website,
      billingCurrency,
      taxId: (record.taxId ?? '').trim() || null,
      status,
      address,
      tags: (record.tags ?? '')
        .split(';')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20),
      notes: (record.notes ?? '').trim() || null,
    },
  };
}

const validateSchema = z.object({
  fileId: z.uuid(),
  sheetName: z.string().optional(),
  mapping: z.record(z.string(), z.string().nullable()),
});

export interface ImportValidation {
  totalRows: number;
  validRows: number;
  errors: RowError[];
  /** Rows whose normalised name or email already exists. */
  duplicates: { row: number; name: string; existingId: string }[];
  truncated: boolean;
}

export const validateClientImport = defineAction({
  name: 'client.import_validate',
  permission: 'client:import',
  input: validateSchema,
  handler: async ({ input, ctx }): Promise<ImportValidation> => {
    const { sheet } = await loadSheet(ctx, input.fileId, input.sheetName, MAX_IMPORT_ROWS);

    if (!Object.values(input.mapping).includes('name')) {
      throw new ActionError('Map a column to the client name before continuing.', {
        code: 'MISSING_NAME_MAPPING',
      });
    }

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { baseCurrency: true },
    });

    const outcome = mapAndValidateRows(sheet, input.mapping, (record) =>
      validateClientRow(record, workspace.baseCurrency),
    );

    // Flag rows that collide with an existing client, and rows that collide
    // with each other inside the same file.
    const normalisedNames = outcome.valid.map((v) => normalizeName(v.data.name));
    const emails = outcome.valid.map((v) => v.data.email).filter((e): e is string => Boolean(e));

    const existing = await prisma.client.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        archivedAt: null,
        OR: [
          { normalizedName: { in: normalisedNames } },
          ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
        ],
      },
      select: { id: true, normalizedName: true, email: true },
    });

    const byName = new Map(existing.map((c) => [c.normalizedName, c.id]));
    const byEmail = new Map(existing.filter((c) => c.email).map((c) => [c.email as string, c.id]));

    const duplicates: ImportValidation['duplicates'] = [];
    for (const row of outcome.valid) {
      const existingId =
        byName.get(normalizeName(row.data.name)) ??
        (row.data.email ? byEmail.get(row.data.email) : undefined);
      if (existingId) duplicates.push({ row: row.row, name: row.data.name, existingId });
    }

    return {
      totalRows: sheet.rows.length,
      validRows: outcome.valid.length,
      errors: outcome.errors,
      duplicates,
      truncated: sheet.truncated,
    };
  },
});

const commitSchema = validateSchema.extend({
  /** Create rows that look like duplicates of an existing client. */
  includeDuplicates: z.boolean().default(false),
});

export const commitClientImport = defineAction({
  name: 'client.import_commit',
  permission: 'client:import',
  input: commitSchema,
  handler: async ({ input, ctx }) => {
    const { sheet } = await loadSheet(ctx, input.fileId, input.sheetName, MAX_IMPORT_ROWS);

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { baseCurrency: true },
    });

    const outcome = mapAndValidateRows(sheet, input.mapping, (record) =>
      validateClientRow(record, workspace.baseCurrency),
    );

    if (outcome.valid.length === 0) {
      throw new ActionError('There are no valid rows to import.', { code: 'NOTHING_TO_IMPORT' });
    }

    const existing = await prisma.client.findMany({
      where: { workspaceId: ctx.workspaceId, archivedAt: null },
      select: { normalizedName: true, email: true },
    });
    const takenNames = new Set(existing.map((c) => c.normalizedName));
    const takenEmails = new Set(existing.map((c) => c.email).filter(Boolean) as string[]);

    const toCreate = outcome.valid.filter(({ data }) => {
      if (input.includeDuplicates) return true;
      const normalised = normalizeName(data.name);
      if (takenNames.has(normalised)) return false;
      if (data.email && takenEmails.has(data.email)) return false;
      // Also guard against duplicates inside the same file.
      takenNames.add(normalised);
      if (data.email) takenEmails.add(data.email);
      return true;
    });

    if (toCreate.length === 0) {
      throw new ActionError(
        'Every valid row matches a client that already exists. Tick "create duplicates anyway" if that is intended.',
        { code: 'ALL_DUPLICATES' },
      );
    }

    // One transaction: either the whole import lands or none of it does.
    const created = await prisma.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const { data } of toCreate) {
        const client = await tx.client.create({
          data: {
            workspaceId: ctx.workspaceId,
            name: data.name,
            normalizedName: normalizeName(data.name),
            type: data.type,
            email: data.email,
            phone: data.phone,
            website: data.website,
            billingCurrency: data.billingCurrency,
            taxId: data.taxId,
            status: data.status,
            tags: data.tags,
            notes: data.notes,
            ...(Object.keys(data.address).length > 0 ? { addressJson: data.address } : {}),
          },
          select: { id: true },
        });
        ids.push(client.id);
      }

      await recordAudit(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.user.id,
          action: 'client.imported',
          entityType: 'Client',
          entityId: null,
          summary: `${ids.length} client(s) imported from a spreadsheet`,
          after: { imported: ids.length, skipped: outcome.valid.length - ids.length },
        },
        tx,
      );

      return ids;
    });

    await prisma.importJob.create({
      data: {
        workspaceId: ctx.workspaceId,
        fileId: input.fileId,
        createdById: ctx.user.id,
        targetType: 'clients',
        status: 'COMMITTED',
        // Prisma's JSON input type does not accept a bare array of typed
        // objects, so serialise through plain JSON.
        headersJson: sheet.headers as Prisma.InputJsonValue,
        mappingJson: input.mapping as Prisma.InputJsonValue,
        ...(outcome.errors.length > 0
          ? { errorsJson: JSON.parse(JSON.stringify(outcome.errors)) as Prisma.InputJsonValue }
          : {}),
        totalRows: sheet.rows.length,
        validRows: outcome.valid.length,
        importedRows: created.length,
      },
    });

    revalidatePath('/clients');
    return {
      imported: created.length,
      skippedInvalid: outcome.errors.length,
      skippedDuplicates: outcome.valid.length - created.length,
    };
  },
});
