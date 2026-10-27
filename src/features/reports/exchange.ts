import { Decimal, dec, roundMoney } from '@/lib/money';

/**
 * Multi-currency consolidation.
 *
 * ## The rules this module exists to enforce
 *
 * 1. The original transaction currency and amount are never altered. A
 *    conversion is an additional, derived figure.
 * 2. A conversion uses a **dated** rate: the most recent rate on or before
 *    the transaction date, never today's rate applied retrospectively.
 * 3. When no suitable rate exists, the amount is **not** converted and is
 *    reported as unconvertible. Unlike currencies are never silently added.
 * 4. Every converted figure carries the rate, its date and its source, so a
 *    reader can audit how a consolidated total was reached.
 *
 * Rates are stored one way (base → quote) and inverted when needed; a direct
 * stored rate always wins over an inverted one.
 */

export interface RateRecord {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  effectiveDate: Date;
  source: string;
}

export interface ConversionDetail {
  rate: string;
  rateDate: Date;
  source: string;
  /** True when the rate was derived by inverting a stored pair. */
  inverted: boolean;
}

export type ConversionResult =
  | { converted: true; amount: string; detail: ConversionDetail }
  | { converted: false; reason: string };

/**
 * Find the rate to use for `from -> to` on `onDate`.
 * Picks the latest effective date that is not after the transaction date.
 */
export function findRate(
  rates: RateRecord[],
  from: string,
  to: string,
  onDate: Date,
): ConversionDetail | null {
  if (from === to) {
    return { rate: '1', rateDate: onDate, source: 'identity', inverted: false };
  }

  const cutoff = onDate.getTime();

  const direct = rates
    .filter(
      (r) =>
        r.baseCurrency === from && r.quoteCurrency === to && r.effectiveDate.getTime() <= cutoff,
    )
    .sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime())[0];

  if (direct) {
    return {
      rate: direct.rate,
      rateDate: direct.effectiveDate,
      source: direct.source,
      inverted: false,
    };
  }

  const reverse = rates
    .filter(
      (r) =>
        r.baseCurrency === to && r.quoteCurrency === from && r.effectiveDate.getTime() <= cutoff,
    )
    .sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime())[0];

  if (reverse) {
    const rate = dec(reverse.rate);
    if (rate.isZero()) return null;
    return {
      rate: new Decimal(1).dividedBy(rate).toDecimalPlaces(10).toString(),
      rateDate: reverse.effectiveDate,
      source: reverse.source,
      inverted: true,
    };
  }

  return null;
}

/** Convert one amount, or explain why it could not be converted. */
export function convertAmount(params: {
  amount: string;
  from: string;
  to: string;
  onDate: Date;
  rates: RateRecord[];
}): ConversionResult {
  const { amount, from, to, onDate, rates } = params;

  if (from === to) {
    return {
      converted: true,
      amount: roundMoney(amount, to).toString(),
      detail: { rate: '1', rateDate: onDate, source: 'identity', inverted: false },
    };
  }

  const detail = findRate(rates, from, to, onDate);
  if (!detail) {
    return {
      converted: false,
      reason: `No ${from}→${to} rate on or before ${onDate.toISOString().slice(0, 10)}.`,
    };
  }

  return {
    converted: true,
    amount: roundMoney(dec(amount).times(dec(detail.rate)), to).toString(),
    detail,
  };
}

export interface ConsolidationInput {
  amount: string;
  currency: string;
  date: Date;
}

export interface ConsolidationResult {
  /** Total in the base currency of everything that could be converted. */
  total: string;
  baseCurrency: string;
  convertedCount: number;
  /**
   * Amounts that could not be converted, grouped by currency. These are
   * reported alongside the total, never folded into it.
   */
  unconverted: Record<string, { amount: string; count: number }>;
  /** Distinct rates used, for the disclosure note under a report. */
  ratesUsed: { pair: string; rate: string; date: Date; source: string; inverted: boolean }[];
  /** True when at least one amount was left out of the total. */
  incomplete: boolean;
}

/**
 * Convert and sum a set of amounts into one base currency.
 *
 * The result separates what was converted from what could not be, so a
 * report can state "PKR 4,210,000 (excludes 3 EUR transactions — no rate)"
 * rather than quietly under-reporting.
 */
export function consolidate(
  items: ConsolidationInput[],
  baseCurrency: string,
  rates: RateRecord[],
): ConsolidationResult {
  let total = new Decimal(0);
  let convertedCount = 0;
  const unconverted: Record<string, { amount: Decimal; count: number }> = {};
  const rateKeys = new Map<
    string,
    { pair: string; rate: string; date: Date; source: string; inverted: boolean }
  >();

  for (const item of items) {
    const result = convertAmount({
      amount: item.amount,
      from: item.currency,
      to: baseCurrency,
      onDate: item.date,
      rates,
    });

    if (result.converted) {
      total = total.plus(result.amount);
      convertedCount += 1;

      if (item.currency !== baseCurrency) {
        const key = `${item.currency}:${result.detail.rateDate.toISOString().slice(0, 10)}`;
        if (!rateKeys.has(key)) {
          rateKeys.set(key, {
            pair: `${item.currency}→${baseCurrency}`,
            rate: result.detail.rate,
            date: result.detail.rateDate,
            source: result.detail.source,
            inverted: result.detail.inverted,
          });
        }
      }
    } else {
      const bucket = unconverted[item.currency] ?? { amount: new Decimal(0), count: 0 };
      bucket.amount = bucket.amount.plus(dec(item.amount));
      bucket.count += 1;
      unconverted[item.currency] = bucket;
    }
  }

  return {
    total: roundMoney(total, baseCurrency).toString(),
    baseCurrency,
    convertedCount,
    unconverted: Object.fromEntries(
      Object.entries(unconverted).map(([currency, bucket]) => [
        currency,
        { amount: roundMoney(bucket.amount, currency).toString(), count: bucket.count },
      ]),
    ),
    ratesUsed: [...rateKeys.values()].sort((a, b) => a.pair.localeCompare(b.pair)),
    incomplete: Object.keys(unconverted).length > 0,
  };
}

/** Human-readable disclosure printed beneath a consolidated figure. */
export function describeConsolidation(result: ConsolidationResult): string {
  if (result.ratesUsed.length === 0 && !result.incomplete) {
    return `All amounts were already in ${result.baseCurrency}; no conversion was applied.`;
  }

  const parts: string[] = [];

  if (result.ratesUsed.length > 0) {
    parts.push(
      `Converted with dated rates: ${result.ratesUsed
        .map(
          (r) =>
            `${r.pair} at ${r.rate} (${r.date.toISOString().slice(0, 10)}, ${r.source}${
              r.inverted ? ', inverted' : ''
            })`,
        )
        .join('; ')}.`,
    );
  }

  if (result.incomplete) {
    const missing = Object.entries(result.unconverted)
      .map(([currency, bucket]) => `${bucket.count} in ${currency}`)
      .join(', ');
    parts.push(
      `Excluded from the total because no rate was available on or before the transaction date: ${missing}.`,
    );
  }

  return parts.join(' ');
}
