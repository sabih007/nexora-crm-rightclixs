import { describe, expect, it } from 'vitest';
import {
  applyRate,
  currencyScale,
  dec,
  formatMoney,
  moneyEquals,
  moneyToString,
  roundMoney,
  sum,
} from '@/lib/money';

describe('currencyScale', () => {
  it('uses two minor digits by default', () => {
    expect(currencyScale('PKR')).toBe(2);
    expect(currencyScale('USD')).toBe(2);
    expect(currencyScale('eur')).toBe(2);
  });

  it('knows zero-decimal currencies', () => {
    expect(currencyScale('JPY')).toBe(0);
    expect(currencyScale('KRW')).toBe(0);
  });

  it('knows three-decimal currencies', () => {
    expect(currencyScale('KWD')).toBe(3);
    expect(currencyScale('BHD')).toBe(3);
  });
});

describe('dec', () => {
  it('treats an empty or missing value as zero', () => {
    expect(dec(null).toString()).toBe('0');
    expect(dec(undefined).toString()).toBe('0');
    expect(dec('').toString()).toBe('0');
  });

  it('preserves decimal meaning for float inputs', () => {
    // The classic 0.1 + 0.2 problem must not appear.
    expect(dec(0.1).plus(dec(0.2)).toString()).toBe('0.3');
  });

  it('rejects malformed input rather than coercing it', () => {
    expect(() => dec('12,50')).toThrow();
    expect(() => dec('abc')).toThrow();
    expect(() => dec(Number.NaN)).toThrow();
    expect(() => dec(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('roundMoney (HALF_UP policy)', () => {
  it('rounds a half unit away from zero', () => {
    expect(roundMoney('1.005', 'USD').toString()).toBe('1.01');
    expect(roundMoney('2.675', 'USD').toString()).toBe('2.68');
    expect(roundMoney('0.125', 'USD').toString()).toBe('0.13');
  });

  it('respects the currency scale', () => {
    expect(roundMoney('1234.56', 'JPY').toString()).toBe('1235');
    expect(roundMoney('1.23456', 'KWD').toString()).toBe('1.235');
  });

  it('is exact for values far beyond float precision', () => {
    expect(moneyToString('9007199254740993.45', 'USD')).toBe('9007199254740993.45');
  });
});

describe('sum', () => {
  it('adds a long list of awkward values exactly', () => {
    const values = Array.from({ length: 10 }, () => '0.1');
    expect(sum(values).toString()).toBe('1');
  });
});

describe('applyRate', () => {
  it('computes a percentage without rounding', () => {
    expect(applyRate('100', '17').toString()).toBe('17');
    expect(applyRate('33.33', '17').toString()).toBe('5.6661');
  });
});

describe('moneyEquals', () => {
  it('compares at the currency minor unit', () => {
    expect(moneyEquals('10.00', '10', 'USD')).toBe(true);
    expect(moneyEquals('10.004', '10.001', 'USD')).toBe(true);
    expect(moneyEquals('10.01', '10.00', 'USD')).toBe(false);
  });
});

describe('formatMoney', () => {
  it('formats known currencies', () => {
    expect(formatMoney('1234.5', 'USD')).toContain('1,234.50');
    expect(formatMoney('1234', 'JPY')).not.toContain('.');
  });

  it('renders an unlisted but well-formed code without throwing', () => {
    // Intl accepts any three-letter code and renders it as a prefix, using a
    // non-breaking space — normalise before comparing.
    expect(formatMoney('10', 'XXZ').replace(/ /g, ' ')).toBe('XXZ 10.00');
  });

  it('falls back to a plain rendering for a malformed code', () => {
    expect(formatMoney('10', 'TOOLONG')).toBe('TOOLONG 10.00');
  });
});
