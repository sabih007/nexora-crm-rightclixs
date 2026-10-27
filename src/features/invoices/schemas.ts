import { z } from 'zod';
import { CURRENCY_REGEX } from '@/lib/money';

/** Invoice, payment and credit-note input validation. */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const dateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.');

/** A monetary amount as an exact decimal string. Never parsed to a float. */
const amountString = (label = 'amount') =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, `Enter a valid ${label}.`);

const optionalAmount = z
  .string()
  .trim()
  .regex(/^(\d+(\.\d{1,4})?)?$/, 'Enter a valid amount.')
  .transform((v) => (v === '' ? '0' : v))
  .default('0');

const rateString = z
  .string()
  .trim()
  .regex(/^(\d{1,3}(\.\d{1,4})?)?$/, 'Enter a percentage between 0 and 100.')
  .transform((v) => (v === '' ? '0' : v))
  .refine((v) => Number(v) >= 0 && Number(v) <= 100, 'Tax rate must be between 0 and 100.')
  .default('0');

export const invoiceLineSchema = z.object({
  id: z.uuid().optional(),
  description: z.string().trim().min(1, 'Describe the line item.').max(500),
  quantity: amountString('quantity'),
  unitPrice: amountString('unit price'),
  discountAmount: optionalAmount,
  taxRate: rateString,
});

export const invoiceInputSchema = z
  .object({
    clientId: z.uuid('Select a client.'),
    projectId: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional()
      .refine((v) => v === null || v === undefined || z.uuid().safeParse(v).success, {
        message: 'Select a valid project.',
      }),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(CURRENCY_REGEX, 'Use a 3-letter ISO currency code.'),
    issueDate: dateString,
    dueDate: dateString,
    taxMode: z.enum(['PER_LINE', 'INVOICE_LEVEL']).default('PER_LINE'),
    invoiceTaxRate: rateString,
    terms: optionalText(3000),
    notes: optionalText(3000),
    lines: z.array(invoiceLineSchema).min(1, 'Add at least one line item.').max(200),
  })
  .refine((v) => v.dueDate >= v.issueDate, {
    message: 'The due date cannot be before the issue date.',
    path: ['dueDate'],
  });

export type InvoiceInput = z.output<typeof invoiceInputSchema>;
export type InvoiceFormValues = z.input<typeof invoiceInputSchema>;

export const updateInvoiceSchema = z.object({
  id: z.uuid(),
  data: invoiceInputSchema,
});

export const invoiceIdSchema = z.object({ id: z.uuid() });

export const issueInvoiceSchema = z.object({
  id: z.uuid(),
  /** Generate a PDF snapshot as part of issuing. */
  generatePdf: z.boolean().default(true),
});

export const voidInvoiceSchema = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(3, 'Give a reason for voiding this invoice.').max(500),
});

export const sendInvoiceSchema = z.object({
  id: z.uuid(),
  /** Blank uses the client's billing email. */
  recipientEmail: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v.toLowerCase()))
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || z.email().safeParse(v).success, {
      message: 'Enter a valid email address.',
    }),
  message: optionalText(2000),
  /** Record the invoice as sent without attempting delivery. */
  markOnly: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const PAYMENT_METHODS = [
  'BANK_TRANSFER',
  'CASH',
  'CHEQUE',
  'CARD',
  'ONLINE',
  'OTHER',
] as const;

export const paymentInputSchema = z.object({
  clientId: z.uuid('Select a client.'),
  /** Pre-selected invoice; allocations may still spread across several. */
  invoiceId: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || z.uuid().safeParse(v).success, {
      message: 'Select a valid invoice.',
    }),
  amount: amountString('amount').refine((v) => Number(v) > 0, 'The amount must be above zero.'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(CURRENCY_REGEX, 'Use a 3-letter ISO currency code.'),
  paymentDate: dateString,
  method: z.enum(PAYMENT_METHODS).default('BANK_TRANSFER'),
  reference: optionalText(200),
  notes: optionalText(2000),
  /** Explicit allocations; when omitted the payment auto-allocates oldest-first. */
  allocations: z
    .array(z.object({ invoiceId: z.uuid(), allocatedAmount: amountString('allocation') }))
    .max(50)
    .default([]),
  /**
   * Client-generated key that makes a retried submit a no-op rather than a
   * second payment. Required: a duplicate payment is the worst bug here.
   */
  idempotencyKey: z.string().trim().min(8).max(100),
});

export type PaymentInput = z.output<typeof paymentInputSchema>;
export type PaymentFormValues = z.input<typeof paymentInputSchema>;

export const paymentIdSchema = z.object({ id: z.uuid() });

export const creditNoteSchema = z.object({
  invoiceId: z.uuid(),
  amount: amountString('amount').refine((v) => Number(v) > 0, 'The amount must be above zero.'),
  reason: z.string().trim().min(3, 'Give a reason for this credit note.').max(500),
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const INVOICE_STATUSES = [
  'DRAFT',
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOID',
  'CANCELLED',
] as const;

export const INVOICE_SORT_KEYS = [
  'invoiceNumber',
  'issueDate',
  'dueDate',
  'grandTotal',
  'status',
] as const;
export type InvoiceSortKey = (typeof INVOICE_SORT_KEYS)[number];

export const invoiceFilterSchema = z.object({
  search: z.string().trim().max(120).default(''),
  status: z.array(z.enum(INVOICE_STATUSES)).default([]),
  clientId: z.string().trim().default(''),
  currency: z.string().trim().toUpperCase().max(3).default(''),
  from: z.string().trim().default(''),
  to: z.string().trim().default(''),
  /** Only invoices with an outstanding balance. */
  unpaidOnly: z.boolean().default(false),
});

export type InvoiceFilters = z.infer<typeof invoiceFilterSchema>;
