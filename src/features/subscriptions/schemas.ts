import { z } from 'zod';
import { CURRENCY_REGEX } from '@/lib/money';

/**
 * Card, platform and subscription validation.
 *
 * SECURITY: there is deliberately no field here capable of accepting a full
 * card number, CVV, PIN or banking password. `last4` is constrained to
 * exactly four digits, and the database carries a matching CHECK constraint
 * so the restriction holds even if this layer is bypassed.
 */

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

const optionalDate = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use the date picker.')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()
  .refine(
    (v) => {
      if (!v) return true;
      try {
        const url = new URL(v.startsWith('http') ? v : `https://${v}`);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Enter a valid http(s) address.' },
  );

// ---------------------------------------------------------------------------
// Payment cards
// ---------------------------------------------------------------------------

export const CARD_BRANDS = [
  'VISA',
  'MASTERCARD',
  'AMEX',
  'DISCOVER',
  'UNIONPAY',
  'JCB',
  'OTHER',
] as const;

export const CARD_STATUSES = ['ACTIVE', 'EXPIRED', 'BLOCKED', 'CANCELLED'] as const;

export const cardInputSchema = z
  .object({
    nickname: z.string().trim().min(1, 'Give the card a nickname.').max(80),
    issuer: z.string().trim().min(1, 'Name the issuing bank.').max(120),
    brand: z.enum(CARD_BRANDS).default('OTHER'),
    /**
     * The ONLY card-number data this application accepts or stores.
     * Four digits, nothing else — a longer value is rejected here and again
     * by the database CHECK constraint.
     */
    last4: z
      .string()
      .trim()
      .regex(/^\d{4}$/, 'Enter exactly the last four digits — never the full card number.'),
    expiryMonth: z
      .union([z.coerce.number().int().min(1).max(12), z.literal('')])
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    expiryYear: z
      .union([z.coerce.number().int().min(2000).max(2100), z.literal('')])
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    ownerId: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional()
      .refine((v) => v === null || v === undefined || z.uuid().safeParse(v).success, {
        message: 'Select a valid owner.',
      }),
    status: z.enum(CARD_STATUSES).default('ACTIVE'),
    notes: optionalText(2000),
  })
  .refine((v) => (v.expiryMonth == null) === (v.expiryYear == null), {
    message: 'Give both the expiry month and year, or neither.',
    path: ['expiryYear'],
  });

export type CardInput = z.output<typeof cardInputSchema>;
export type CardFormValues = z.input<typeof cardInputSchema>;

export const updateCardSchema = z.object({ id: z.uuid(), data: cardInputSchema });
export const cardIdSchema = z.object({ id: z.uuid() });

// ---------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------

export const PLATFORM_CATEGORIES = [
  'Hosting',
  'Design',
  'Developer tools',
  'Marketing',
  'Email',
  'Analytics',
  'Productivity',
  'Finance',
  'Security',
  'AI',
  'Other',
] as const;

export const platformInputSchema = z.object({
  name: z.string().trim().min(1, 'Name the platform.').max(120),
  websiteUrl: httpUrl,
  category: z.string().trim().min(1).max(60).default('Other'),
  /** Non-secret identifier such as the login email. Never a password. */
  accountIdentifier: optionalText(200),
  cancellationUrl: httpUrl,
  ownerId: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || z.uuid().safeParse(v).success, {
      message: 'Select a valid owner.',
    }),
  notes: optionalText(2000),
});

export type PlatformInput = z.output<typeof platformInputSchema>;
export type PlatformFormValues = z.input<typeof platformInputSchema>;

export const updatePlatformSchema = z.object({ id: z.uuid(), data: platformInputSchema });
export const platformIdSchema = z.object({ id: z.uuid() });

// ---------------------------------------------------------------------------
// Card ↔ platform links
// ---------------------------------------------------------------------------

export const LINK_STATUSES = ['ACTIVE', 'REMOVED', 'UNKNOWN'] as const;

export const platformLinkSchema = z.object({
  platformId: z.uuid(),
  cardId: z.uuid(),
  status: z.enum(LINK_STATUSES).default('ACTIVE'),
  linkedAt: optionalDate,
  responsibleId: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || z.uuid().safeParse(v).success, {
      message: 'Select a valid person.',
    }),
  notes: optionalText(1000),
});

export const linkIdSchema = z.object({ id: z.uuid() });

export const markLinkRemovedSchema = z.object({
  id: z.uuid(),
  removedAt: dateString,
  notes: optionalText(1000),
});

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const CADENCES = ['MONTHLY', 'QUARTERLY', 'ANNUAL', 'WEEKLY', 'CUSTOM_DAYS'] as const;
export const SUBSCRIPTION_STATUSES = [
  'ACTIVE',
  'TRIAL',
  'PAUSED',
  'CANCELLED',
  'EXPIRED',
] as const;

const amountString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,4})?$/, 'Enter a valid amount.');

export const subscriptionInputSchema = z
  .object({
    platformId: z.uuid('Select a platform.'),
    cardId: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional()
      .refine((v) => v === null || v === undefined || z.uuid().safeParse(v).success, {
        message: 'Select a valid card.',
      }),
    projectId: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional()
      .refine((v) => v === null || v === undefined || z.uuid().safeParse(v).success, {
        message: 'Select a valid project.',
      }),
    clientId: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional()
      .refine((v) => v === null || v === undefined || z.uuid().safeParse(v).success, {
        message: 'Select a valid client.',
      }),
    planName: z.string().trim().min(1, 'Name the plan.').max(160),
    amount: amountString,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(CURRENCY_REGEX, 'Use a 3-letter ISO currency code.'),
    cadence: z.enum(CADENCES).default('MONTHLY'),
    intervalDays: z
      .union([z.coerce.number().int().min(1).max(3650), z.literal('')])
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    nextChargeAt: dateString,
    startedAt: dateString,
    endsAt: optionalDate,
    trialEndsAt: optionalDate,
    autoRenew: z.boolean().default(true),
    status: z.enum(SUBSCRIPTION_STATUSES).default('ACTIVE'),
    category: z.string().trim().min(1).max(60).default('Software'),
    costCenter: optionalText(120),
    noticeDays: z
      .union([z.coerce.number().int().min(0).max(365), z.literal('')])
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    taxInclusive: z.boolean().default(true),
    notes: optionalText(2000),
  })
  .refine((v) => v.cadence !== 'CUSTOM_DAYS' || (v.intervalDays != null && v.intervalDays > 0), {
    message: 'A custom cadence needs the number of days between charges.',
    path: ['intervalDays'],
  })
  .refine((v) => !v.endsAt || v.endsAt >= v.startedAt, {
    message: 'The end date cannot be before the start date.',
    path: ['endsAt'],
  });

export type SubscriptionInput = z.output<typeof subscriptionInputSchema>;
export type SubscriptionFormValues = z.input<typeof subscriptionInputSchema>;

export const updateSubscriptionSchema = z.object({
  id: z.uuid(),
  data: subscriptionInputSchema,
});
export const subscriptionIdSchema = z.object({ id: z.uuid() });

/** Roll a subscription forward after a charge has actually been paid. */
export const recordChargeSchema = z.object({
  subscriptionId: z.uuid(),
  amount: amountString,
  paidAt: dateString,
  reference: optionalText(200),
  /** Advance nextChargeAt by one billing period. */
  advanceSchedule: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const EXPENSE_CATEGORIES = [
  'Software',
  'Hosting',
  'Marketing',
  'Office',
  'Travel',
  'Professional fees',
  'Equipment',
  'Utilities',
  'Other',
] as const;

export const expenseInputSchema = z.object({
  subscriptionId: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || z.uuid().safeParse(v).success, {
      message: 'Select a valid subscription.',
    }),
  projectId: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || z.uuid().safeParse(v).success, {
      message: 'Select a valid project.',
    }),
  clientId: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || z.uuid().safeParse(v).success, {
      message: 'Select a valid client.',
    }),
  amount: amountString,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(CURRENCY_REGEX, 'Use a 3-letter ISO currency code.'),
  paidAt: dateString,
  category: z.string().trim().min(1).max(60).default('Software'),
  description: z.string().trim().min(1, 'Describe the expense.').max(500),
  reference: optionalText(200),
});

export type ExpenseInput = z.output<typeof expenseInputSchema>;
export type ExpenseFormValues = z.input<typeof expenseInputSchema>;

export const updateExpenseSchema = z.object({ id: z.uuid(), data: expenseInputSchema });
export const expenseIdSchema = z.object({ id: z.uuid() });

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const SUBSCRIPTION_SORT_KEYS = [
  'nextChargeAt',
  'planName',
  'amount',
  'status',
  'category',
] as const;
export type SubscriptionSortKey = (typeof SUBSCRIPTION_SORT_KEYS)[number];

export const subscriptionFilterSchema = z.object({
  search: z.string().trim().max(120).default(''),
  status: z.array(z.enum(SUBSCRIPTION_STATUSES)).default([]),
  cadence: z.array(z.enum(CADENCES)).default([]),
  cardId: z.string().trim().default(''),
  platformId: z.string().trim().default(''),
  currency: z.string().trim().toUpperCase().max(3).default(''),
  category: z.string().trim().max(60).default(''),
  ownerId: z.string().trim().default(''),
  /** Only subscriptions charging within this many days. */
  dueWithinDays: z.coerce.number().int().min(0).max(365).optional(),
});

export type SubscriptionFilters = z.infer<typeof subscriptionFilterSchema>;
