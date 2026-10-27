import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfYear,
  format,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
} from 'date-fns';

/**
 * Date helpers.
 *
 * Business dates (issue date, due date, next charge date) are stored as
 * Postgres DATE and treated as calendar days with no timezone — they are
 * constructed at UTC midnight so serialising never shifts them a day.
 * Instants (createdAt, sentAt) keep full timestamp semantics.
 */

export const DATE_FORMAT = 'dd MMM yyyy';
export const DATETIME_FORMAT = 'dd MMM yyyy, HH:mm';

export function formatDate(value: Date | string | null | undefined, pattern = DATE_FORMAT): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? parseISO(value) : value;
  return isValid(date) ? format(date, pattern) : '—';
}

export function formatDateTime(value: Date | string | null | undefined): string {
  return formatDate(value, DATETIME_FORMAT);
}

/** "in 3 days" / "2 days ago" / "today" */
export function relativeDays(value: Date | string | null | undefined, from = new Date()): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? parseISO(value) : value;
  if (!isValid(date)) return '—';
  const diff = differenceInCalendarDays(startOfDay(date), startOfDay(from));
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  return diff > 0 ? `in ${diff} days` : `${Math.abs(diff)} days ago`;
}

export function daysUntil(value: Date | string, from = new Date()): number {
  const date = typeof value === 'string' ? parseISO(value) : value;
  return differenceInCalendarDays(startOfDay(date), startOfDay(from));
}

/** Date to the YYYY-MM-DD form used by date inputs and DATE columns. */
export function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = typeof value === 'string' ? parseISO(value) : value;
  return isValid(date) ? format(date, 'yyyy-MM-dd') : '';
}

/** Parse YYYY-MM-DD into a UTC-midnight Date. */
export function fromDateInput(value: string): Date {
  const parts = value.split('-').map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d || Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) {
    throw new Error(`Invalid date: ${value}`);
  }
  return new Date(Date.UTC(y, m - 1, d));
}

export function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export type DateRangePreset =
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'this_year'
  | 'last_year'
  | 'all_time'
  | 'custom';

export const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_90_days', label: 'Last 90 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'this_year', label: 'This year' },
  { value: 'last_year', label: 'Last year' },
  { value: 'all_time', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
];

export function isDateRangePreset(value: string): value is DateRangePreset {
  return DATE_RANGE_PRESETS.some((p) => p.value === value);
}

export function resolveDateRange(
  preset: DateRangePreset,
  custom?: { from?: string; to?: string },
): { from: Date; to: Date; label: string } {
  const now = todayUtc();
  const label = DATE_RANGE_PRESETS.find((p) => p.value === preset)?.label ?? 'Custom range';

  switch (preset) {
    case 'last_7_days':
      return { from: subDays(now, 6), to: now, label };
    case 'last_30_days':
      return { from: subDays(now, 29), to: now, label };
    case 'last_90_days':
      return { from: subDays(now, 89), to: now, label };
    case 'this_month':
      return { from: startOfMonth(now), to: endOfMonth(now), label };
    case 'last_month': {
      const prev = subMonths(now, 1);
      return { from: startOfMonth(prev), to: endOfMonth(prev), label };
    }
    case 'this_quarter': {
      const q = Math.floor(now.getUTCMonth() / 3);
      const from = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
      return { from, to: endOfMonth(addMonths(from, 2)), label };
    }
    case 'this_year':
      return { from: startOfYear(now), to: endOfYear(now), label };
    case 'last_year': {
      const prev = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
      return { from: startOfYear(prev), to: endOfYear(prev), label };
    }
    case 'all_time':
      return { from: new Date(Date.UTC(1970, 0, 1)), to: addDays(now, 3650), label };
    case 'custom':
    default: {
      const from = custom?.from ? fromDateInput(custom.from) : subDays(now, 29);
      const to = custom?.to ? fromDateInput(custom.to) : now;
      return { from, to, label };
    }
  }
}

export { addDays, addMonths, differenceInCalendarDays, parseISO, startOfDay, subDays };
