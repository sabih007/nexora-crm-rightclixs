import { Decimal, dec, roundMoney, sum } from '@/lib/money';

/**
 * Invoice arithmetic.
 *
 * Pure, dependency-free and exhaustively unit-tested. Server actions call it
 * to recompute every total from the line items; a client-submitted total is
 * never trusted.
 *
 * ## Rounding policy
 *
 * Working precision is 28 significant digits. Rounding to the currency's
 * minor unit happens at exactly three points:
 *   1. each line's net (after discount),
 *   2. each line's tax,
 *   3. the grand total.
 *
 * Because the subtotal and tax total are sums of already-rounded line values,
 * the figures printed on an invoice always add up — there is no penny that
 * appears only in the total.
 *
 * ## Tax modes
 *
 * PER_LINE       each line carries its own rate; tax = Σ round(net_i × rate_i)
 * INVOICE_LEVEL  one rate on the whole net subtotal; tax = round(subtotal × rate)
 *
 * Discounts are absolute amounts per line, applied before tax, and are capped
 * at the line's gross so a line can never go negative.
 */

export type TaxMode = 'PER_LINE' | 'INVOICE_LEVEL';

export interface LineInput {
  description?: string;
  quantity: string | number;
  unitPrice: string | number;
  discountAmount?: string | number | null;
  /** Percentage, e.g. "17" for 17%. Ignored when taxMode is INVOICE_LEVEL. */
  taxRate?: string | number | null;
}

export interface ComputedLine {
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxRate: string;
  /** Gross before discount: quantity × unitPrice. */
  lineGross: string;
  /** Net after discount — this is what the subtotal sums. */
  lineSubtotal: string;
  lineTax: string;
  /** Net + tax. */
  lineTotal: string;
}

export interface InvoiceTotals {
  lines: ComputedLine[];
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
}

export interface TotalsInput {
  lines: LineInput[];
  currency: string;
  taxMode: TaxMode;
  /** Percentage used when taxMode is INVOICE_LEVEL. */
  invoiceTaxRate?: string | number | null;
}

export function computeInvoiceTotals({
  lines,
  currency,
  taxMode,
  invoiceTaxRate,
}: TotalsInput): InvoiceTotals {
  const computed: ComputedLine[] = [];

  for (const line of lines) {
    const quantity = dec(line.quantity);
    const unitPrice = dec(line.unitPrice);
    const requestedDiscount = dec(line.discountAmount ?? 0);
    const taxRate = taxMode === 'PER_LINE' ? dec(line.taxRate ?? 0) : new Decimal(0);

    const gross = roundMoney(quantity.times(unitPrice), currency);

    // A discount can reduce a line to zero but never below it.
    const discount = requestedDiscount.greaterThan(gross)
      ? gross
      : roundMoney(requestedDiscount, currency);

    const net = roundMoney(gross.minus(discount), currency);
    const tax = roundMoney(net.times(taxRate).dividedBy(100), currency);

    computed.push({
      quantity: quantity.toString(),
      unitPrice: unitPrice.toString(),
      discountAmount: discount.toString(),
      taxRate: taxRate.toString(),
      lineGross: gross.toString(),
      lineSubtotal: net.toString(),
      lineTax: tax.toString(),
      lineTotal: roundMoney(net.plus(tax), currency).toString(),
    });
  }

  const subtotal = sum(computed.map((l) => l.lineSubtotal));
  const discountTotal = sum(computed.map((l) => l.discountAmount));

  const taxTotal =
    taxMode === 'INVOICE_LEVEL'
      ? roundMoney(subtotal.times(dec(invoiceTaxRate ?? 0)).dividedBy(100), currency)
      : sum(computed.map((l) => l.lineTax));

  const grandTotal = roundMoney(subtotal.plus(taxTotal), currency);

  return {
    lines: computed,
    subtotal: roundMoney(subtotal, currency).toString(),
    discountTotal: roundMoney(discountTotal, currency).toString(),
    taxTotal: roundMoney(taxTotal, currency).toString(),
    grandTotal: grandTotal.toString(),
  };
}

// ---------------------------------------------------------------------------
// Balances and status
// ---------------------------------------------------------------------------

export interface BalanceInput {
  grandTotal: string | number;
  amountPaid: string | number;
  creditedTotal?: string | number | null;
  currency: string;
}

/**
 * Outstanding balance = grand total − payments − credit notes.
 * Clamped at zero: an overpayment shows as a credit, not a negative balance.
 */
export function outstandingBalance({
  grandTotal,
  amountPaid,
  creditedTotal,
  currency,
}: BalanceInput): string {
  const balance = dec(grandTotal).minus(dec(amountPaid)).minus(dec(creditedTotal ?? 0));
  return roundMoney(balance.isNegative() ? new Decimal(0) : balance, currency).toString();
}

/** Amount paid beyond what was owed, available to allocate elsewhere. */
export function overpaymentAmount({
  grandTotal,
  amountPaid,
  creditedTotal,
  currency,
}: BalanceInput): string {
  const over = dec(amountPaid).plus(dec(creditedTotal ?? 0)).minus(dec(grandTotal));
  return roundMoney(over.isNegative() ? new Decimal(0) : over, currency).toString();
}

export type InvoiceStatus =
  | 'DRAFT'
  | 'SENT'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'
  | 'VOID'
  | 'CANCELLED';

/**
 * Derive the status of an issued invoice from its money and dates.
 *
 * DRAFT, VOID and CANCELLED are explicit states set by a user action and are
 * never inferred — this function returns them unchanged. Everything else is a
 * function of balance and due date, so the list cannot drift out of sync with
 * the payments recorded against it.
 */
export function deriveInvoiceStatus(params: {
  currentStatus: InvoiceStatus;
  grandTotal: string | number;
  amountPaid: string | number;
  creditedTotal?: string | number | null;
  dueDate: Date;
  currency: string;
  asOf?: Date;
}): InvoiceStatus {
  const { currentStatus, dueDate, currency, asOf = new Date() } = params;

  if (currentStatus === 'DRAFT' || currentStatus === 'VOID' || currentStatus === 'CANCELLED') {
    return currentStatus;
  }

  const balance = dec(
    outstandingBalance({
      grandTotal: params.grandTotal,
      amountPaid: params.amountPaid,
      creditedTotal: params.creditedTotal,
      currency,
    }),
  );

  if (balance.isZero()) return 'PAID';

  // Compare calendar days: an invoice due today is not overdue until tomorrow.
  const dueDay = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const today = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const isOverdue = today > dueDay;

  const paid = dec(params.amountPaid).plus(dec(params.creditedTotal ?? 0));
  if (isOverdue) return 'OVERDUE';
  if (paid.greaterThan(0)) return 'PARTIALLY_PAID';
  return 'SENT';
}

/** Days past due; zero when not yet due. */
export function daysOverdue(dueDate: Date, asOf: Date = new Date()): number {
  const dueDay = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const today = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const diff = Math.floor((today - dueDay) / 86_400_000);
  return diff > 0 ? diff : 0;
}

// ---------------------------------------------------------------------------
// Payment allocation
// ---------------------------------------------------------------------------

export interface AllocationTarget {
  invoiceId: string;
  /** Outstanding balance on that invoice before this payment. */
  balance: string;
}

export interface AllocationResult {
  allocations: { invoiceId: string; allocatedAmount: string }[];
  /** Amount left over after every target was filled. */
  unallocated: string;
}

/**
 * Allocate a payment across invoices, oldest first, never exceeding each
 * invoice's outstanding balance. Any remainder is returned as `unallocated`
 * so the caller can record it as a client credit — it is never silently
 * dropped or used to push an invoice into a negative balance.
 */
export function allocatePayment(
  amount: string | number,
  targets: AllocationTarget[],
  currency: string,
): AllocationResult {
  let remaining = roundMoney(amount, currency);
  const allocations: { invoiceId: string; allocatedAmount: string }[] = [];

  for (const target of targets) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const balance = roundMoney(target.balance, currency);
    if (balance.lessThanOrEqualTo(0)) continue;

    const applied = Decimal.min(remaining, balance);
    allocations.push({ invoiceId: target.invoiceId, allocatedAmount: applied.toString() });
    remaining = roundMoney(remaining.minus(applied), currency);
  }

  return { allocations, unallocated: remaining.toString() };
}

/**
 * Validate that explicit allocations are internally consistent before they
 * are written: each positive, none exceeding its invoice balance, and the sum
 * not exceeding the payment.
 */
export function validateAllocations(params: {
  paymentAmount: string | number;
  allocations: { invoiceId: string; allocatedAmount: string | number }[];
  balances: Record<string, string>;
  currency: string;
}): { valid: true } | { valid: false; reason: string } {
  const { paymentAmount, allocations, balances, currency } = params;

  for (const allocation of allocations) {
    const value = dec(allocation.allocatedAmount);
    if (value.lessThanOrEqualTo(0)) {
      return { valid: false, reason: 'Each allocation must be greater than zero.' };
    }
    const balance = balances[allocation.invoiceId];
    if (balance === undefined) {
      return { valid: false, reason: 'An allocation refers to an unknown invoice.' };
    }
    if (roundMoney(value, currency).greaterThan(roundMoney(balance, currency))) {
      return {
        valid: false,
        reason: 'An allocation exceeds the outstanding balance on its invoice.',
      };
    }
  }

  const allocated = sum(allocations.map((a) => a.allocatedAmount));
  if (roundMoney(allocated, currency).greaterThan(roundMoney(paymentAmount, currency))) {
    return { valid: false, reason: 'Allocations add up to more than the payment amount.' };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Invoice numbering
// ---------------------------------------------------------------------------

/**
 * Build the next invoice number.
 * The sequence is held on the workspace row and incremented inside the same
 * transaction that creates the invoice, so two concurrent issues cannot
 * collide — and the `(workspaceId, invoiceNumber)` unique index is the
 * backstop if they somehow do.
 */
export function formatInvoiceNumber(params: {
  prefix: string;
  sequence: number;
  padding: number;
  includeYear: boolean;
  year?: number;
}): string {
  const { prefix, sequence, padding, includeYear, year = new Date().getUTCFullYear() } = params;
  const num = String(sequence).padStart(Math.max(1, Math.min(10, padding)), '0');
  return includeYear ? `${prefix}-${year}-${num}` : `${prefix}-${num}`;
}
