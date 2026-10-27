import Decimal from 'decimal.js';

/**
 * Money handling for Nexora OS.
 *
 * ## Rounding policy (authoritative)
 *
 * 1. All arithmetic is performed with `Decimal` at 10 decimal places of
 *    working precision. JavaScript `number` is never used for money.
 * 2. Rounding to the currency's minor unit happens at exactly three points:
 *      • each invoice line total,
 *      • each tax amount,
 *      • the invoice grand total.
 *    Intermediate sums are *not* re-rounded, so the displayed line totals
 *    always add up to the displayed invoice total.
 * 3. The rounding mode is HALF_UP (0.005 -> 0.01), matching the convention
 *    used by most tax authorities for invoice presentation.
 * 4. Minor-unit scale comes from the currency: 2 for most, 0 for zero-decimal
 *    currencies (JPY, KRW, PKR is 2, …), 3 for a few Gulf currencies.
 *
 * Any change to this policy is a breaking financial change and must be
 * accompanied by a migration plan for historic invoices.
 */

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -18, toExpPos: 24 });

export { Decimal };

/** Currencies with no minor unit. */
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

/** Currencies with three minor digits. */
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export function currencyScale(currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

export type MoneyInput = Decimal | string | number;

/**
 * Build a Decimal from untrusted input.
 * Numbers are accepted for ergonomics but are converted via their string form
 * so that a literal like 0.1 keeps its decimal meaning.
 */
export function dec(value: MoneyInput | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  if (value instanceof Decimal) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite monetary value: ${value}`);
    return new Decimal(value.toString());
  }
  const trimmed = value.trim();
  if (!/^-?\d*(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid monetary value: ${value}`);
  }
  return new Decimal(trimmed);
}

/** Round to the currency's minor unit using the documented HALF_UP policy. */
export function roundMoney(value: MoneyInput, currency: string): Decimal {
  return dec(value).toDecimalPlaces(currencyScale(currency), Decimal.ROUND_HALF_UP);
}

/** Canonical string form for persistence: fixed to the currency's scale. */
export function moneyToString(value: MoneyInput, currency: string): string {
  return roundMoney(value, currency).toFixed(currencyScale(currency));
}

export function sum(values: Iterable<MoneyInput>): Decimal {
  let total = new Decimal(0);
  for (const v of values) total = total.plus(dec(v));
  return total;
}

export function isZero(value: MoneyInput): boolean {
  return dec(value).isZero();
}

export function isNegative(value: MoneyInput): boolean {
  return dec(value).isNegative();
}

/** Percentage application: `base * rate / 100`, unrounded. */
export function applyRate(base: MoneyInput, ratePercent: MoneyInput): Decimal {
  return dec(base).times(dec(ratePercent)).dividedBy(100);
}

/**
 * Compare two amounts to within the currency's smallest unit.
 * Use this instead of `.equals()` when comparing a computed total to a stored
 * one, so a trailing-zero difference does not read as a mismatch.
 */
export function moneyEquals(a: MoneyInput, b: MoneyInput, currency: string): boolean {
  return roundMoney(a, currency).equals(roundMoney(b, currency));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(currency: string, locale: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}|${locale}|${compact}`;
  let f = formatterCache.get(key);
  if (!f) {
    const scale = currencyScale(currency);
    f = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: compact ? 0 : scale,
      maximumFractionDigits: compact ? 1 : scale,
      ...(compact ? { notation: 'compact' as const } : {}),
    });
    formatterCache.set(key, f);
  }
  return f;
}

export function formatMoney(
  value: MoneyInput | null | undefined,
  currency: string,
  options: { locale?: string; compact?: boolean } = {},
): string {
  const { locale = 'en-US', compact = false } = options;
  const amount = roundMoney(value ?? 0, currency);
  try {
    return getFormatter(currency, locale, compact).format(amount.toNumber());
  } catch {
    // Unknown/placeholder currency code — fall back to a plain rendering
    // rather than throwing inside a React render.
    return `${currency.toUpperCase()} ${amount.toFixed(currencyScale(currency))}`;
  }
}

/** Plain number formatting (quantities, counts) without currency symbols. */
export function formatNumber(value: MoneyInput, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(dec(value).toNumber());
}

export function formatPercent(value: MoneyInput, fractionDigits = 1): string {
  return `${dec(value).toDecimalPlaces(fractionDigits, Decimal.ROUND_HALF_UP).toFixed(fractionDigits)}%`;
}

// ---------------------------------------------------------------------------
// Currency registry
// ---------------------------------------------------------------------------

/** Currencies surfaced first in pickers. Any ISO 4217 code is still accepted. */
export const PRIORITY_CURRENCIES = ['PKR', 'USD', 'EUR', 'GBP'] as const;

export const CURRENCIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'PKR', name: 'Pakistani Rupee' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'Pound Sterling' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'TRY', name: 'Turkish Lira' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'MYR', name: 'Malaysian Ringgit' },
  { code: 'QAR', name: 'Qatari Riyal' },
  { code: 'KWD', name: 'Kuwaiti Dinar' },
  { code: 'BHD', name: 'Bahraini Dinar' },
  { code: 'OMR', name: 'Omani Rial' },
  { code: 'BDT', name: 'Bangladeshi Taka' },
  { code: 'LKR', name: 'Sri Lankan Rupee' },
  { code: 'THB', name: 'Thai Baht' },
  { code: 'IDR', name: 'Indonesian Rupiah' },
  { code: 'PHP', name: 'Philippine Peso' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'EGP', name: 'Egyptian Pound' },
  { code: 'NGN', name: 'Nigerian Naira' },
  { code: 'KES', name: 'Kenyan Shilling' },
];

const CURRENCY_CODES = new Set(CURRENCIES.map((c) => c.code));

export function isKnownCurrency(code: string): boolean {
  return CURRENCY_CODES.has(code.toUpperCase());
}

/** Validator used by Zod schemas: any well-formed ISO 4217 code is allowed. */
export const CURRENCY_REGEX = /^[A-Z]{3}$/;
