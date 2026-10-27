import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  computeInvoiceTotals,
  daysOverdue,
  deriveInvoiceStatus,
  formatInvoiceNumber,
  outstandingBalance,
  overpaymentAmount,
  validateAllocations,
} from '@/features/invoices/calculations';

describe('computeInvoiceTotals', () => {
  it('computes a single untaxed line', () => {
    const totals = computeInvoiceTotals({
      currency: 'USD',
      taxMode: 'PER_LINE',
      lines: [{ quantity: '2', unitPrice: '150.00' }],
    });
    expect(totals.subtotal).toBe('300');
    expect(totals.taxTotal).toBe('0');
    expect(totals.grandTotal).toBe('300');
  });

  it('applies a per-line tax rate', () => {
    const totals = computeInvoiceTotals({
      currency: 'USD',
      taxMode: 'PER_LINE',
      lines: [
        { quantity: '1', unitPrice: '100', taxRate: '17' },
        { quantity: '1', unitPrice: '50', taxRate: '5' },
      ],
    });
    expect(totals.subtotal).toBe('150');
    expect(totals.taxTotal).toBe('19.5'); // 17 + 2.50
    expect(totals.grandTotal).toBe('169.5');
  });

  it('applies invoice-level tax to the net subtotal, ignoring line rates', () => {
    const totals = computeInvoiceTotals({
      currency: 'USD',
      taxMode: 'INVOICE_LEVEL',
      invoiceTaxRate: '10',
      lines: [
        { quantity: '1', unitPrice: '100', taxRate: '17' },
        { quantity: '1', unitPrice: '100', taxRate: '99' },
      ],
    });
    expect(totals.subtotal).toBe('200');
    expect(totals.taxTotal).toBe('20');
    expect(totals.grandTotal).toBe('220');
    expect(totals.lines.every((l) => l.lineTax === '0')).toBe(true);
  });

  it('applies the discount before tax', () => {
    const totals = computeInvoiceTotals({
      currency: 'USD',
      taxMode: 'PER_LINE',
      lines: [{ quantity: '1', unitPrice: '200', discountAmount: '50', taxRate: '10' }],
    });
    expect(totals.subtotal).toBe('150');
    expect(totals.discountTotal).toBe('50');
    expect(totals.taxTotal).toBe('15');
    expect(totals.grandTotal).toBe('165');
  });

  it('caps a discount at the line gross so a line can never go negative', () => {
    const totals = computeInvoiceTotals({
      currency: 'USD',
      taxMode: 'PER_LINE',
      lines: [{ quantity: '1', unitPrice: '100', discountAmount: '500' }],
    });
    expect(totals.discountTotal).toBe('100');
    expect(totals.subtotal).toBe('0');
    expect(totals.grandTotal).toBe('0');
  });

  it('keeps printed line totals adding up to the printed grand total', () => {
    // Each of these lines rounds individually; a naive implementation that
    // rounds only at the end would print totals that do not reconcile.
    const totals = computeInvoiceTotals({
      currency: 'USD',
      taxMode: 'PER_LINE',
      lines: Array.from({ length: 7 }, () => ({
        quantity: '3',
        unitPrice: '33.333',
        taxRate: '17',
      })),
    });

    const sumOfLines = totals.lines.reduce((acc, l) => acc + Number(l.lineTotal), 0);
    expect(Number(totals.grandTotal)).toBeCloseTo(sumOfLines, 10);
    expect(Number(totals.subtotal)).toBeCloseTo(
      totals.lines.reduce((acc, l) => acc + Number(l.lineSubtotal), 0),
      10,
    );
  });

  it('rounds to the currency minor unit (zero-decimal)', () => {
    const totals = computeInvoiceTotals({
      currency: 'JPY',
      taxMode: 'PER_LINE',
      lines: [{ quantity: '3', unitPrice: '333.4', taxRate: '8' }],
    });
    expect(totals.subtotal).toBe('1000');
    expect(totals.taxTotal).toBe('80');
    expect(totals.grandTotal).toBe('1080');
  });

  it('rounds to three minor digits for KWD', () => {
    const totals = computeInvoiceTotals({
      currency: 'KWD',
      taxMode: 'PER_LINE',
      lines: [{ quantity: '1', unitPrice: '10.1239' }],
    });
    expect(totals.subtotal).toBe('10.124');
  });

  it('handles fractional quantities exactly', () => {
    const totals = computeInvoiceTotals({
      currency: 'USD',
      taxMode: 'PER_LINE',
      lines: [{ quantity: '0.1', unitPrice: '0.2' }],
    });
    expect(totals.subtotal).toBe('0.02');
  });

  it('returns zeroes for an invoice with no lines', () => {
    const totals = computeInvoiceTotals({ currency: 'PKR', taxMode: 'PER_LINE', lines: [] });
    expect(totals).toMatchObject({
      subtotal: '0',
      discountTotal: '0',
      taxTotal: '0',
      grandTotal: '0',
    });
  });

  it('is exact for large amounts beyond float precision', () => {
    const totals = computeInvoiceTotals({
      currency: 'PKR',
      taxMode: 'PER_LINE',
      lines: [{ quantity: '1', unitPrice: '9007199254740993.45' }],
    });
    expect(totals.grandTotal).toBe('9007199254740993.45');
  });
});

describe('outstandingBalance / overpaymentAmount', () => {
  it('subtracts payments and credit notes', () => {
    expect(
      outstandingBalance({ grandTotal: '1000', amountPaid: '300', creditedTotal: '200', currency: 'USD' }),
    ).toBe('500');
  });

  it('clamps at zero rather than reporting a negative balance', () => {
    expect(
      outstandingBalance({ grandTotal: '100', amountPaid: '150', currency: 'USD' }),
    ).toBe('0');
  });

  it('reports the surplus as an overpayment', () => {
    expect(overpaymentAmount({ grandTotal: '100', amountPaid: '150', currency: 'USD' })).toBe('50');
    expect(overpaymentAmount({ grandTotal: '100', amountPaid: '80', currency: 'USD' })).toBe('0');
  });
});

describe('deriveInvoiceStatus', () => {
  const dueDate = new Date(Date.UTC(2026, 5, 15));
  const base = { grandTotal: '1000', currency: 'USD', dueDate } as const;

  it('never infers an explicit state', () => {
    for (const status of ['DRAFT', 'VOID', 'CANCELLED'] as const) {
      expect(
        deriveInvoiceStatus({
          ...base,
          currentStatus: status,
          amountPaid: '1000',
          asOf: new Date(Date.UTC(2026, 5, 1)),
        }),
      ).toBe(status);
    }
  });

  it('is PAID once the balance reaches zero, even after the due date', () => {
    expect(
      deriveInvoiceStatus({
        ...base,
        currentStatus: 'OVERDUE',
        amountPaid: '1000',
        asOf: new Date(Date.UTC(2026, 7, 1)),
      }),
    ).toBe('PAID');
  });

  it('is SENT when nothing is paid and the invoice is not yet due', () => {
    expect(
      deriveInvoiceStatus({
        ...base,
        currentStatus: 'SENT',
        amountPaid: '0',
        asOf: new Date(Date.UTC(2026, 5, 1)),
      }),
    ).toBe('SENT');
  });

  it('is PARTIALLY_PAID when some is paid and it is not yet due', () => {
    expect(
      deriveInvoiceStatus({
        ...base,
        currentStatus: 'SENT',
        amountPaid: '400',
        asOf: new Date(Date.UTC(2026, 5, 1)),
      }),
    ).toBe('PARTIALLY_PAID');
  });

  it('is not overdue on the due date itself', () => {
    expect(
      deriveInvoiceStatus({
        ...base,
        currentStatus: 'SENT',
        amountPaid: '0',
        asOf: new Date(Date.UTC(2026, 5, 15, 23, 59)),
      }),
    ).toBe('SENT');
  });

  it('becomes overdue the day after the due date', () => {
    expect(
      deriveInvoiceStatus({
        ...base,
        currentStatus: 'SENT',
        amountPaid: '0',
        asOf: new Date(Date.UTC(2026, 5, 16)),
      }),
    ).toBe('OVERDUE');
  });

  it('counts a credit note toward settling the invoice', () => {
    expect(
      deriveInvoiceStatus({
        ...base,
        currentStatus: 'SENT',
        amountPaid: '600',
        creditedTotal: '400',
        asOf: new Date(Date.UTC(2026, 7, 1)),
      }),
    ).toBe('PAID');
  });
});

describe('daysOverdue', () => {
  it('is zero before and on the due date', () => {
    const due = new Date(Date.UTC(2026, 5, 15));
    expect(daysOverdue(due, new Date(Date.UTC(2026, 5, 10)))).toBe(0);
    expect(daysOverdue(due, new Date(Date.UTC(2026, 5, 15)))).toBe(0);
  });

  it('counts whole days after the due date', () => {
    const due = new Date(Date.UTC(2026, 5, 15));
    expect(daysOverdue(due, new Date(Date.UTC(2026, 5, 20)))).toBe(5);
  });
});

describe('allocatePayment', () => {
  it('fills invoices in order without exceeding their balances', () => {
    const result = allocatePayment(
      '500',
      [
        { invoiceId: 'a', balance: '200' },
        { invoiceId: 'b', balance: '400' },
      ],
      'USD',
    );
    expect(result.allocations).toEqual([
      { invoiceId: 'a', allocatedAmount: '200' },
      { invoiceId: 'b', allocatedAmount: '300' },
    ]);
    expect(result.unallocated).toBe('0');
  });

  it('returns the surplus rather than overfilling', () => {
    const result = allocatePayment('500', [{ invoiceId: 'a', balance: '200' }], 'USD');
    expect(result.allocations).toEqual([{ invoiceId: 'a', allocatedAmount: '200' }]);
    expect(result.unallocated).toBe('300');
  });

  it('skips invoices that are already settled', () => {
    const result = allocatePayment(
      '100',
      [
        { invoiceId: 'a', balance: '0' },
        { invoiceId: 'b', balance: '100' },
      ],
      'USD',
    );
    expect(result.allocations).toEqual([{ invoiceId: 'b', allocatedAmount: '100' }]);
  });

  it('allocates nothing when there are no targets', () => {
    const result = allocatePayment('100', [], 'USD');
    expect(result.allocations).toEqual([]);
    expect(result.unallocated).toBe('100');
  });
});

describe('validateAllocations', () => {
  const balances = { a: '200', b: '400' };

  it('accepts a consistent set', () => {
    expect(
      validateAllocations({
        paymentAmount: '500',
        allocations: [
          { invoiceId: 'a', allocatedAmount: '200' },
          { invoiceId: 'b', allocatedAmount: '300' },
        ],
        balances,
        currency: 'USD',
      }),
    ).toEqual({ valid: true });
  });

  it('rejects an allocation above the invoice balance', () => {
    const result = validateAllocations({
      paymentAmount: '500',
      allocations: [{ invoiceId: 'a', allocatedAmount: '300' }],
      balances,
      currency: 'USD',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects allocations summing above the payment', () => {
    const result = validateAllocations({
      paymentAmount: '100',
      allocations: [
        { invoiceId: 'a', allocatedAmount: '60' },
        { invoiceId: 'b', allocatedAmount: '60' },
      ],
      balances,
      currency: 'USD',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects a zero or negative allocation', () => {
    expect(
      validateAllocations({
        paymentAmount: '100',
        allocations: [{ invoiceId: 'a', allocatedAmount: '0' }],
        balances,
        currency: 'USD',
      }).valid,
    ).toBe(false);
  });

  it('rejects an allocation to an unknown invoice', () => {
    expect(
      validateAllocations({
        paymentAmount: '100',
        allocations: [{ invoiceId: 'zzz', allocatedAmount: '10' }],
        balances,
        currency: 'USD',
      }).valid,
    ).toBe(false);
  });
});

describe('formatInvoiceNumber', () => {
  it('pads the sequence and includes the year', () => {
    expect(
      formatInvoiceNumber({ prefix: 'INV', sequence: 7, padding: 4, includeYear: true, year: 2026 }),
    ).toBe('INV-2026-0007');
  });

  it('omits the year when configured', () => {
    expect(formatInvoiceNumber({ prefix: 'NX', sequence: 42, padding: 5, includeYear: false })).toBe(
      'NX-00042',
    );
  });

  it('does not truncate a sequence longer than the padding', () => {
    expect(
      formatInvoiceNumber({ prefix: 'INV', sequence: 123456, padding: 3, includeYear: false }),
    ).toBe('INV-123456');
  });
});
