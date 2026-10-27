import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names, with later Tailwind utilities winning. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Stable initials for avatars, max two characters. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Normalise a company/person name for duplicate detection: case-folded,
 * accent-stripped, punctuation-free, with common legal suffixes removed so
 * "Acme Ltd." and "ACME Limited" collide.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(
      /\b(ltd|limited|inc|incorporated|llc|llp|plc|pvt|private|co|company|corp|corporation|gmbh|bv)\b/g,
      '',
    )
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

interface SearchParamsLike {
  toString(): string;
}

/** Build a querystring from existing params plus overrides. */
export function withSearchParams(
  current: SearchParamsLike,
  updates: Record<string, string | number | null | undefined>,
): string {
  const params = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === '') params.delete(key);
    else params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

const AVATAR_COLORS = [
  '#315CFD',
  '#0EA5E9',
  '#0F9D58',
  '#B45309',
  '#7C3AED',
  '#DB2777',
  '#0E7490',
  '#C2410C',
];

/** Deterministic palette colour from a string (avatars, tag chips). */
export function colorForString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] as string;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Byte size for humans: 1.4 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
