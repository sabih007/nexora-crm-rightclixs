import 'server-only';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';

/**
 * Spreadsheet reading.
 *
 * ## Scope, stated plainly
 *
 * This reads tabular data out of CSV and XLSX files so it can be previewed,
 * mapped and imported. It is **not** an Excel implementation: formulas are
 * read as their last cached value, and formatting, charts, macros, pivot
 * tables and multi-range references are ignored. The original file is always
 * preserved untouched in storage, so nothing is lost by this limitation.
 *
 * ## Safety
 *
 * Untrusted workbooks are parsed defensively: row and column counts are
 * capped before allocation, so a sheet declaring a million rows cannot
 * exhaust memory, and cell text is truncated.
 */

export const MAX_PREVIEW_ROWS = 50;
export const MAX_IMPORT_ROWS = 5000;
export const MAX_COLUMNS = 64;
const MAX_CELL_LENGTH = 2000;

export interface SheetData {
  /** Sheet name; "CSV" for a comma-separated file. */
  name: string;
  headers: string[];
  rows: string[][];
  /** Rows actually read, which may be fewer than the file contains. */
  rowCount: number;
  /** True when the file holds more rows than were read. */
  truncated: boolean;
}

export interface ParseResult {
  sheets: SheetData[];
  warnings: string[];
}

function clampCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === 'object') {
    const cell = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    // A formula cell: take the cached result, never evaluate anything.
    if ('result' in cell && cell.result !== undefined) return clampCell(cell.result);
    if (Array.isArray(cell.richText)) return cell.richText.map((r) => r.text).join('');
    if (typeof cell.text === 'string') return cell.text.slice(0, MAX_CELL_LENGTH);
    return '';
  }

  return String(value).slice(0, MAX_CELL_LENGTH);
}

/** Parse a CSV buffer into a single sheet. */
export function parseCsv(buffer: Buffer, limit = MAX_IMPORT_ROWS): SheetData {
  const text = buffer.toString('utf8').replace(/^﻿/, '');

  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
    // Read every cell as text: coercing "007" to 7 or a date string to a Date
    // silently corrupts data on import.
    dynamicTyping: false,
  });

  const allRows = (parsed.data as unknown as string[][]).filter((row) =>
    row.some((cell) => String(cell ?? '').trim() !== ''),
  );

  const headerRow = allRows[0] ?? [];
  const headers = headerRow.slice(0, MAX_COLUMNS).map((h, i) => clampCell(h) || `Column ${i + 1}`);
  const bodyRows = allRows.slice(1);

  return {
    name: 'CSV',
    headers,
    rows: bodyRows.slice(0, limit).map((row) => {
      const cells = row.slice(0, headers.length).map(clampCell);
      while (cells.length < headers.length) cells.push('');
      return cells;
    }),
    rowCount: bodyRows.length,
    truncated: bodyRows.length > limit,
  };
}

/** Parse an XLSX buffer into one sheet per worksheet. */
export async function parseXlsx(buffer: Buffer, limit = MAX_IMPORT_ROWS): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheets: SheetData[] = [];
  const warnings: string[] = [];

  workbook.eachSheet((worksheet) => {
    const headerRow = worksheet.getRow(1);
    const columnCount = Math.min(worksheet.columnCount || 0, MAX_COLUMNS);
    if (columnCount === 0) return;

    if (worksheet.columnCount > MAX_COLUMNS) {
      warnings.push(
        `Sheet "${worksheet.name}" has ${worksheet.columnCount} columns; only the first ${MAX_COLUMNS} were read.`,
      );
    }

    const headers: string[] = [];
    for (let col = 1; col <= columnCount; col += 1) {
      const text = clampCell(headerRow.getCell(col).value);
      headers.push(text || `Column ${col}`);
    }

    const rows: string[][] = [];
    const lastRow = worksheet.rowCount || 1;
    for (let rowNumber = 2; rowNumber <= lastRow && rows.length < limit; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const cells: string[] = [];
      for (let col = 1; col <= columnCount; col += 1) {
        cells.push(clampCell(row.getCell(col).value));
      }
      if (cells.some((c) => c.trim() !== '')) rows.push(cells);
    }

    const bodyCount = Math.max(0, lastRow - 1);
    if (bodyCount > limit) {
      warnings.push(
        `Sheet "${worksheet.name}" has ${bodyCount} rows; only the first ${limit} were read.`,
      );
    }

    sheets.push({
      name: worksheet.name,
      headers,
      rows,
      rowCount: bodyCount,
      truncated: bodyCount > limit,
    });
  });

  if (sheets.length === 0) warnings.push('The workbook contains no readable sheets.');

  return { sheets, warnings };
}

/** Dispatch on extension; the caller has already validated the file. */
export async function parseSpreadsheet(
  buffer: Buffer,
  originalName: string,
  limit = MAX_IMPORT_ROWS,
): Promise<ParseResult> {
  const lower = originalName.toLowerCase();
  if (lower.endsWith('.csv')) {
    return { sheets: [parseCsv(buffer, limit)], warnings: [] };
  }
  if (lower.endsWith('.xlsx')) {
    return parseXlsx(buffer, limit);
  }
  throw new Error('Only .csv and .xlsx files can be previewed as data.');
}

// ---------------------------------------------------------------------------
// Mapping and validation
// ---------------------------------------------------------------------------

export interface RowError {
  /** 1-based row number as the user sees it in the spreadsheet. */
  row: number;
  field: string;
  message: string;
  value?: string;
}

export interface ValidationOutcome<T> {
  valid: { row: number; data: T }[];
  errors: RowError[];
}

/**
 * Apply a header→field mapping and validate each row.
 *
 * Every row is validated; the import is only offered once the user has seen
 * the complete error list. Nothing is written during this pass.
 */
export function mapAndValidateRows<T>(
  sheet: SheetData,
  mapping: Record<string, string | null>,
  validate: (record: Record<string, string>, row: number) => { ok: true; data: T } | { ok: false; errors: Omit<RowError, 'row'>[] },
): ValidationOutcome<T> {
  const outcome: ValidationOutcome<T> = { valid: [], errors: [] };

  // field -> column index
  const columnForField = new Map<string, number>();
  for (const [header, field] of Object.entries(mapping)) {
    if (!field) continue;
    const index = sheet.headers.indexOf(header);
    if (index >= 0) columnForField.set(field, index);
  }

  sheet.rows.forEach((cells, i) => {
    // +2: one for the header row, one to make it 1-based.
    const rowNumber = i + 2;

    const record: Record<string, string> = {};
    for (const [field, index] of columnForField) {
      record[field] = (cells[index] ?? '').trim();
    }

    const result = validate(record, rowNumber);
    if (result.ok) {
      outcome.valid.push({ row: rowNumber, data: result.data });
    } else {
      for (const error of result.errors) {
        outcome.errors.push({ row: rowNumber, ...error });
      }
    }
  });

  return outcome;
}

/**
 * Guess a header→field mapping so the user starts from something sensible.
 * Matching is case- and punctuation-insensitive.
 */
export function suggestMapping(
  headers: string[],
  fields: readonly { key: string; label: string }[],
): Record<string, string | null> {
  const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapping: Record<string, string | null> = {};
  const used = new Set<string>();

  for (const header of headers) {
    const normalisedHeader = normalise(header);
    const match = fields.find(
      (field) =>
        !used.has(field.key) &&
        (normalise(field.key) === normalisedHeader ||
          normalise(field.label) === normalisedHeader ||
          normalisedHeader.includes(normalise(field.key))),
    );
    mapping[header] = match?.key ?? null;
    if (match) used.add(match.key);
  }

  return mapping;
}
