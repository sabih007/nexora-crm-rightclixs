import { describe, expect, it } from 'vitest';
import {
  consolidate,
  convertAmount,
  describeConsolidation,
  findRate,
  type RateRecord,
} from '@/features/reports/exchange';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const RATES: RateRecord[] = [
  {
    baseCurrency: 'USD',
    quoteCurrency: 'PKR',
    rate: '270.00',
    effectiveDate: utc(2026, 1, 1),
    source: 'manual',
  },
  {
    baseCurrency: 'USD',
    quoteCurrency: 'PKR',
    rate: '280.00',
    effectiveDate: utc(2026, 6, 1),
    source: 'manual',
  },
  {
    baseCurrency: 'GBP',
    quoteCurrency: 'PKR',
    rate: '350.00',
    effectiveDate: utc(2026, 1, 1),
    source: 'manual',
  },
];

describe('findRate', () => {
  it('uses the latest rate on or before the transaction date', () => {
    const early = findRate(RATES, 'USD', 'PKR', utc(2026, 3, 15));
    expect(early?.rate).toBe('270.00');

    const later = findRate(RATES, 'USD', 'PKR', utc(2026, 8, 15));
    expect(later?.rate).toBe('280.00');
  });

  it('uses a rate effective on the exact transaction date', () => {
    expect(findRate(RATES, 'USD', 'PKR', utc(2026, 6, 1))?.rate).toBe('280.00');
  });

  it('never reaches forward to a future rate', () => {
    expect(findRate(RATES, 'USD', 'PKR', utc(2025, 12, 31))).toBeNull();
  });

  it('inverts a stored pair when no direct rate exists', () => {
    const detail = findRate(RATES, 'PKR', 'USD', utc(2026, 8, 1));
    expect(detail?.inverted).toBe(true);
    expect(Number(detail?.rate)).toBeCloseTo(1 / 280, 10);
  });

  it('prefers a direct rate over an inverted one', () => {
    const rates: RateRecord[] = [
      ...RATES,
      {
        baseCurrency: 'PKR',
        quoteCurrency: 'USD',
        rate: '0.004',
        effectiveDate: utc(2026, 7, 1),
        source: 'direct',
      },
    ];
    const detail = findRate(rates, 'PKR', 'USD', utc(2026, 8, 1));
    expect(detail?.inverted).toBe(false);
    expect(detail?.rate).toBe('0.004');
  });

  it('treats an identical pair as rate 1', () => {
    expect(findRate(RATES, 'PKR', 'PKR', utc(2026, 1, 1))?.rate).toBe('1');
  });

  it('returns null for an unknown pair', () => {
    expect(findRate(RATES, 'JPY', 'PKR', utc(2026, 8, 1))).toBeNull();
  });
});

describe('convertAmount', () => {
  it('converts with the dated rate, not the current one', () => {
    const result = convertAmount({
      amount: '100',
      from: 'USD',
      to: 'PKR',
      onDate: utc(2026, 3, 1),
      rates: RATES,
    });
    expect(result.converted).toBe(true);
    if (result.converted) {
      expect(result.amount).toBe('27000');
      expect(result.detail.rate).toBe('270.00');
      expect(result.detail.rateDate).toEqual(utc(2026, 1, 1));
    }
  });

  it('refuses rather than guessing when no rate exists', () => {
    const result = convertAmount({
      amount: '100',
      from: 'JPY',
      to: 'PKR',
      onDate: utc(2026, 3, 1),
      rates: RATES,
    });
    expect(result.converted).toBe(false);
    if (!result.converted) expect(result.reason).toContain('No JPY→PKR rate');
  });

  it('passes an already-base amount through untouched', () => {
    const result = convertAmount({
      amount: '1234.56',
      from: 'PKR',
      to: 'PKR',
      onDate: utc(2026, 3, 1),
      rates: [],
    });
    expect(result.converted).toBe(true);
    if (result.converted) expect(result.amount).toBe('1234.56');
  });

  it('rounds the converted figure to the target currency', () => {
    const result = convertAmount({
      amount: '1',
      from: 'PKR',
      to: 'USD',
      onDate: utc(2026, 8, 1),
      rates: RATES,
    });
    if (result.converted) expect(result.amount).toBe('0');
  });
});

describe('consolidate', () => {
  it('sums converted amounts and reports the rates used', () => {
    const result = consolidate(
      [
        { amount: '100', currency: 'USD', date: utc(2026, 3, 1) },
        { amount: '100', currency: 'GBP', date: utc(2026, 3, 1) },
        { amount: '5000', currency: 'PKR', date: utc(2026, 3, 1) },
      ],
      'PKR',
      RATES,
    );

    // 27,000 + 35,000 + 5,000
    expect(result.total).toBe('67000');
    expect(result.convertedCount).toBe(3);
    expect(result.incomplete).toBe(false);
    expect(result.ratesUsed).toHaveLength(2);
  });

  it('excludes unconvertible amounts rather than guessing', () => {
    const result = consolidate(
      [
        { amount: '100', currency: 'USD', date: utc(2026, 3, 1) },
        { amount: '500', currency: 'JPY', date: utc(2026, 3, 1) },
        { amount: '600', currency: 'JPY', date: utc(2026, 4, 1) },
      ],
      'PKR',
      RATES,
    );

    expect(result.total).toBe('27000');
    expect(result.convertedCount).toBe(1);
    expect(result.incomplete).toBe(true);
    expect(result.unconverted.JPY).toEqual({ amount: '1100', count: 2 });
  });

  it('applies the rate that was current at each transaction date', () => {
    const result = consolidate(
      [
        { amount: '100', currency: 'USD', date: utc(2026, 3, 1) },
        { amount: '100', currency: 'USD', date: utc(2026, 8, 1) },
      ],
      'PKR',
      RATES,
    );

    // 27,000 at the January rate + 28,000 at the June rate.
    expect(result.total).toBe('55000');
    expect(result.ratesUsed).toHaveLength(2);
  });

  it('handles an empty set', () => {
    const result = consolidate([], 'PKR', RATES);
    expect(result.total).toBe('0');
    expect(result.incomplete).toBe(false);
  });

  it('needs no rates when everything is already in the base currency', () => {
    const result = consolidate(
      [
        { amount: '1000', currency: 'PKR', date: utc(2026, 3, 1) },
        { amount: '2000', currency: 'PKR', date: utc(2026, 4, 1) },
      ],
      'PKR',
      [],
    );
    expect(result.total).toBe('3000');
    expect(result.ratesUsed).toHaveLength(0);
    expect(result.incomplete).toBe(false);
  });
});

describe('describeConsolidation', () => {
  it('names the rate, its date and its source', () => {
    const result = consolidate(
      [{ amount: '100', currency: 'USD', date: utc(2026, 3, 1) }],
      'PKR',
      RATES,
    );
    const note = describeConsolidation(result);
    expect(note).toContain('USD→PKR');
    expect(note).toContain('270.00');
    expect(note).toContain('2026-01-01');
    expect(note).toContain('manual');
  });

  it('discloses what was left out', () => {
    const result = consolidate(
      [{ amount: '500', currency: 'JPY', date: utc(2026, 3, 1) }],
      'PKR',
      RATES,
    );
    const note = describeConsolidation(result);
    expect(note).toContain('Excluded from the total');
    expect(note).toContain('JPY');
  });

  it('says so plainly when no conversion happened', () => {
    const result = consolidate(
      [{ amount: '100', currency: 'PKR', date: utc(2026, 3, 1) }],
      'PKR',
      [],
    );
    expect(describeConsolidation(result)).toContain('no conversion was applied');
  });
});
