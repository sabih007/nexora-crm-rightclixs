import { describe, expect, it } from 'vitest';
import {
  advanceChargeDate,
  annualizedCost,
  cadenceLabel,
  cancellationDeadline,
  chargesPerYear,
  commitmentTotals,
  isBilling,
  monthlyEquivalent,
  totalChargesByCurrency,
  upcomingCharges,
  type ForecastSubscription,
} from '@/features/subscriptions/forecast';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('chargesPerYear', () => {
  it('matches the cadence', () => {
    expect(chargesPerYear('MONTHLY').toString()).toBe('12');
    expect(chargesPerYear('QUARTERLY').toString()).toBe('4');
    expect(chargesPerYear('ANNUAL').toString()).toBe('1');
    expect(chargesPerYear('WEEKLY').toString()).toBe('52');
  });

  it('derives a custom cadence from the real interval', () => {
    expect(chargesPerYear('CUSTOM_DAYS', 30).toFixed(4)).toBe('12.1750');
    expect(chargesPerYear('CUSTOM_DAYS', 365).toFixed(4)).toBe('1.0007');
  });

  it('rejects a custom cadence with no interval', () => {
    expect(() => chargesPerYear('CUSTOM_DAYS')).toThrow();
    expect(() => chargesPerYear('CUSTOM_DAYS', 0)).toThrow();
    expect(() => chargesPerYear('CUSTOM_DAYS', -5)).toThrow();
  });
});

describe('monthlyEquivalent', () => {
  const base = { currency: 'USD', nextChargeAt: utc(2026, 1, 1) };

  it('returns the amount unchanged for a monthly plan', () => {
    expect(monthlyEquivalent({ ...base, amount: '249.00', cadence: 'MONTHLY' })).toBe('249');
  });

  it('divides an annual plan by twelve, as the spec requires', () => {
    expect(monthlyEquivalent({ ...base, amount: '1200', cadence: 'ANNUAL' })).toBe('100');
    expect(monthlyEquivalent({ ...base, amount: '1199.88', cadence: 'ANNUAL' })).toBe('99.99');
  });

  it('divides a quarterly plan by three', () => {
    expect(monthlyEquivalent({ ...base, amount: '540', cadence: 'QUARTERLY' })).toBe('180');
  });

  it('annualises a weekly plan on the stated 52-week basis', () => {
    // 100 × 52 / 12 = 433.333…
    expect(monthlyEquivalent({ ...base, amount: '100', cadence: 'WEEKLY' })).toBe('433.33');
  });

  it('uses the real schedule for a custom cadence, not an average', () => {
    // 45-day cycle: 365.25/45 = 8.1167 charges a year → ×100 /12
    expect(
      monthlyEquivalent({ ...base, amount: '100', cadence: 'CUSTOM_DAYS', intervalDays: 45 }),
    ).toBe('67.64');
  });

  it('rounds once, at the end, to the currency minor unit', () => {
    expect(monthlyEquivalent({ ...base, amount: '1000', cadence: 'ANNUAL' })).toBe('83.33');
    expect(
      monthlyEquivalent({ ...base, amount: '1000', cadence: 'ANNUAL', currency: 'JPY' }),
    ).toBe('83');
  });
});

describe('annualizedCost', () => {
  const base = { currency: 'USD', nextChargeAt: utc(2026, 1, 1) };

  it('multiplies by the yearly charge count', () => {
    expect(annualizedCost({ ...base, amount: '249', cadence: 'MONTHLY' })).toBe('2988');
    expect(annualizedCost({ ...base, amount: '540', cadence: 'QUARTERLY' })).toBe('2160');
    expect(annualizedCost({ ...base, amount: '1200', cadence: 'ANNUAL' })).toBe('1200');
  });
});

describe('advanceChargeDate', () => {
  it('advances a month', () => {
    expect(advanceChargeDate(utc(2026, 1, 15), 'MONTHLY').toISOString().slice(0, 10)).toBe(
      '2026-02-15',
    );
  });

  it('keeps the billing anchor through a short month', () => {
    // 31 Jan bills on 28 Feb, not 3 March.
    expect(advanceChargeDate(utc(2026, 1, 31), 'MONTHLY').toISOString().slice(0, 10)).toBe(
      '2026-02-28',
    );
  });

  it('returns to the anchor day after a short month', () => {
    const feb = advanceChargeDate(utc(2026, 1, 31), 'MONTHLY');
    const mar = advanceChargeDate(feb, 'MONTHLY');
    expect(mar.toISOString().slice(0, 10)).toBe('2026-03-28');
  });

  it('handles a leap year', () => {
    expect(advanceChargeDate(utc(2028, 1, 31), 'MONTHLY').toISOString().slice(0, 10)).toBe(
      '2028-02-29',
    );
  });

  it('advances quarterly and annually', () => {
    expect(advanceChargeDate(utc(2026, 1, 15), 'QUARTERLY').toISOString().slice(0, 10)).toBe(
      '2026-04-15',
    );
    expect(advanceChargeDate(utc(2026, 1, 15), 'ANNUAL').toISOString().slice(0, 10)).toBe(
      '2027-01-15',
    );
  });

  it('advances weekly and by a custom interval', () => {
    expect(advanceChargeDate(utc(2026, 1, 1), 'WEEKLY').toISOString().slice(0, 10)).toBe(
      '2026-01-08',
    );
    expect(
      advanceChargeDate(utc(2026, 1, 1), 'CUSTOM_DAYS', 45).toISOString().slice(0, 10),
    ).toBe('2026-02-15');
  });

  it('crosses a year boundary', () => {
    expect(advanceChargeDate(utc(2026, 12, 20), 'MONTHLY').toISOString().slice(0, 10)).toBe(
      '2027-01-20',
    );
  });
});

describe('upcomingCharges', () => {
  function sub(overrides: Partial<ForecastSubscription> = {}): ForecastSubscription {
    return {
      id: 'sub-1',
      platformName: 'Cloudhost',
      planName: 'Business',
      amount: '100',
      currency: 'USD',
      cadence: 'MONTHLY',
      nextChargeAt: utc(2026, 1, 10),
      category: 'Hosting',
      status: 'ACTIVE',
      autoRenew: true,
      ...overrides,
    };
  }

  it('lists every charge inside the window, not an average', () => {
    const charges = upcomingCharges([sub({ cadence: 'WEEKLY' })], {
      from: utc(2026, 1, 1),
      to: utc(2026, 1, 31),
    });
    // 10, 17, 24, 31 January.
    expect(charges).toHaveLength(4);
    expect(charges.map((c) => c.chargeDate.toISOString().slice(0, 10))).toEqual([
      '2026-01-10',
      '2026-01-17',
      '2026-01-24',
      '2026-01-31',
    ]);
  });

  it('skips subscriptions that are not billing', () => {
    for (const status of ['PAUSED', 'CANCELLED', 'EXPIRED']) {
      const charges = upcomingCharges([sub({ status })], {
        from: utc(2026, 1, 1),
        to: utc(2026, 12, 31),
      });
      expect(charges).toHaveLength(0);
    }
  });

  it('includes a trial subscription', () => {
    const charges = upcomingCharges([sub({ status: 'TRIAL' })], {
      from: utc(2026, 1, 1),
      to: utc(2026, 1, 31),
    });
    expect(charges).toHaveLength(1);
  });

  it('stops at the end date', () => {
    const charges = upcomingCharges([sub({ endsAt: utc(2026, 3, 1) })], {
      from: utc(2026, 1, 1),
      to: utc(2026, 12, 31),
    });
    expect(charges).toHaveLength(2); // January and February
  });

  it('emits a single final charge when auto-renew is off', () => {
    const charges = upcomingCharges([sub({ autoRenew: false })], {
      from: utc(2026, 1, 1),
      to: utc(2026, 12, 31),
    });
    expect(charges).toHaveLength(1);
  });

  it('does not emit charges before the window', () => {
    const charges = upcomingCharges([sub({ nextChargeAt: utc(2025, 6, 10) })], {
      from: utc(2026, 1, 1),
      to: utc(2026, 1, 31),
    });
    expect(charges).toHaveLength(1);
    expect(charges[0]?.chargeDate.toISOString().slice(0, 10)).toBe('2026-01-10');
  });

  it('orders charges across subscriptions by date', () => {
    const charges = upcomingCharges(
      [
        sub({ id: 'a', nextChargeAt: utc(2026, 1, 20) }),
        sub({ id: 'b', nextChargeAt: utc(2026, 1, 5) }),
      ],
      { from: utc(2026, 1, 1), to: utc(2026, 1, 31) },
    );
    expect(charges.map((c) => c.subscriptionId)).toEqual(['b', 'a']);
  });

  it('returns nothing for an empty window', () => {
    expect(
      upcomingCharges([sub()], { from: utc(2026, 2, 1), to: utc(2026, 2, 5) }),
    ).toHaveLength(0);
  });
});

describe('commitmentTotals', () => {
  it('groups by currency and never sums unlike currencies', () => {
    const totals = commitmentTotals([
      {
        id: '1',
        platformName: 'A',
        planName: 'P',
        amount: '100',
        currency: 'USD',
        cadence: 'MONTHLY',
        nextChargeAt: utc(2026, 1, 1),
        category: 'X',
        status: 'ACTIVE',
      },
      {
        id: '2',
        platformName: 'B',
        planName: 'P',
        amount: '1200',
        currency: 'USD',
        cadence: 'ANNUAL',
        nextChargeAt: utc(2026, 1, 1),
        category: 'X',
        status: 'ACTIVE',
      },
      {
        id: '3',
        platformName: 'C',
        planName: 'P',
        amount: '5000',
        currency: 'PKR',
        cadence: 'MONTHLY',
        nextChargeAt: utc(2026, 1, 1),
        category: 'X',
        status: 'ACTIVE',
      },
    ]);

    expect(totals.monthlyByCurrency).toEqual({ USD: '200', PKR: '5000' });
    expect(totals.annualByCurrency).toEqual({ USD: '2400', PKR: '60000' });
    expect(totals.activeCount).toBe(3);
  });

  it('excludes paused and cancelled subscriptions', () => {
    const totals = commitmentTotals([
      {
        id: '1',
        platformName: 'A',
        planName: 'P',
        amount: '100',
        currency: 'USD',
        cadence: 'MONTHLY',
        nextChargeAt: utc(2026, 1, 1),
        category: 'X',
        status: 'PAUSED',
      },
    ]);
    expect(totals.activeCount).toBe(0);
    expect(totals.monthlyByCurrency).toEqual({});
  });
});

describe('totalChargesByCurrency', () => {
  it('sums each currency separately', () => {
    const totals = totalChargesByCurrency([
      {
        subscriptionId: '1',
        platformName: 'A',
        planName: 'P',
        amount: '100.50',
        currency: 'USD',
        chargeDate: utc(2026, 1, 1),
        cardLabel: null,
        category: 'X',
      },
      {
        subscriptionId: '2',
        platformName: 'B',
        planName: 'P',
        amount: '99.50',
        currency: 'USD',
        chargeDate: utc(2026, 1, 2),
        cardLabel: null,
        category: 'X',
      },
      {
        subscriptionId: '3',
        platformName: 'C',
        planName: 'P',
        amount: '5000',
        currency: 'PKR',
        chargeDate: utc(2026, 1, 3),
        cardLabel: null,
        category: 'X',
      },
    ]);
    expect(totals).toEqual({ USD: '200', PKR: '5000' });
  });
});

describe('cancellationDeadline', () => {
  it('subtracts the notice period', () => {
    expect(
      cancellationDeadline(utc(2026, 6, 30), 30)?.toISOString().slice(0, 10),
    ).toBe('2026-05-31');
  });

  it('is null when no notice is required', () => {
    expect(cancellationDeadline(utc(2026, 6, 30), null)).toBeNull();
    expect(cancellationDeadline(utc(2026, 6, 30), 0)).toBeNull();
  });
});

describe('isBilling', () => {
  it('counts active and trial only', () => {
    expect(isBilling({ status: 'ACTIVE' })).toBe(true);
    expect(isBilling({ status: 'TRIAL' })).toBe(true);
    expect(isBilling({ status: 'PAUSED' })).toBe(false);
    expect(isBilling({})).toBe(true);
  });
});

describe('cadenceLabel', () => {
  it('names the interval for a custom cadence', () => {
    expect(cadenceLabel('CUSTOM_DAYS', 45)).toBe('Every 45 days');
    expect(cadenceLabel('ANNUAL')).toBe('Annual');
  });
});
