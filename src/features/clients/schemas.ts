import { z } from 'zod';
import { CURRENCY_REGEX } from '@/lib/money';

/**
 * Client input validation.
 * These schemas are the single source of truth for both the React Hook Form
 * resolver and the server action, so the client and server agree on the rules.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const addressSchema = z.object({
  line1: optionalText(200),
  line2: optionalText(200),
  city: optionalText(120),
  state: optionalText(120),
  postalCode: optionalText(40),
  country: optionalText(120),
});

export type ClientAddress = z.infer<typeof addressSchema>;

export const clientContactSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, 'Contact name is required.').max(160),
  email: z
    .string()
    .trim()
    .max(254)
    .transform((v) => (v === '' ? null : v.toLowerCase()))
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || z.email().safeParse(v).success, {
      message: 'Enter a valid email address.',
    }),
  phone: optionalText(60),
  position: optionalText(120),
  isPrimary: z.boolean().default(false),
});

export const clientInputSchema = z.object({
  type: z.enum(['COMPANY', 'INDIVIDUAL']).default('COMPANY'),
  name: z.string().trim().min(1, 'Name is required.').max(200),
  email: z
    .string()
    .trim()
    .max(254)
    .transform((v) => (v === '' ? null : v.toLowerCase()))
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || z.email().safeParse(v).success, {
      message: 'Enter a valid email address.',
    }),
  phone: optionalText(60),
  website: z
    .string()
    .trim()
    .max(300)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .refine(
      (v) => {
        if (!v) return true;
        try {
          // Only http(s) — a javascript: or data: URL must never be stored and
          // later rendered as a link.
          const url = new URL(v.startsWith('http') ? v : `https://${v}`);
          return url.protocol === 'http:' || url.protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'Enter a valid http(s) website address.' },
    ),
  billingCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(CURRENCY_REGEX, 'Use a 3-letter ISO currency code.'),
  taxId: optionalText(80),
  status: z.enum(['ACTIVE', 'PROSPECT', 'INACTIVE', 'ARCHIVED']).default('ACTIVE'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  notes: optionalText(5000),
  address: addressSchema.optional(),
  contacts: z.array(clientContactSchema).max(25).default([]),
  /** Set when the user has reviewed a duplicate warning and wants to proceed. */
  allowDuplicate: z.boolean().default(false),
});

/** Parsed/validated shape handed to the server action. */
export type ClientInput = z.output<typeof clientInputSchema>;
/** Raw shape the form holds before Zod applies defaults and transforms. */
export type ClientFormValues = z.input<typeof clientInputSchema>;

export const updateClientSchema = clientInputSchema.extend({ id: z.uuid() });

export const clientIdSchema = z.object({ id: z.uuid() });

export const archiveClientSchema = z.object({
  id: z.uuid(),
  archived: z.boolean(),
});

// ---------------------------------------------------------------------------
// List filters
// ---------------------------------------------------------------------------

export const CLIENT_SORT_KEYS = ['name', 'createdAt', 'status', 'billingCurrency'] as const;
export type ClientSortKey = (typeof CLIENT_SORT_KEYS)[number];

export const clientFilterSchema = z.object({
  search: z.string().trim().max(120).default(''),
  status: z.array(z.enum(['ACTIVE', 'PROSPECT', 'INACTIVE', 'ARCHIVED'])).default([]),
  type: z.array(z.enum(['COMPANY', 'INDIVIDUAL'])).default([]),
  currency: z.string().trim().toUpperCase().max(3).default(''),
  tag: z.string().trim().max(40).default(''),
  includeArchived: z.boolean().default(false),
});

export type ClientFilters = z.infer<typeof clientFilterSchema>;

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

/** Fields a CSV column can be mapped onto. */
export const CLIENT_IMPORT_FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'type', label: 'Type (COMPANY / INDIVIDUAL)', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'website', label: 'Website', required: false },
  { key: 'billingCurrency', label: 'Billing currency', required: false },
  { key: 'taxId', label: 'Tax ID', required: false },
  { key: 'status', label: 'Status', required: false },
  { key: 'addressLine1', label: 'Address line 1', required: false },
  { key: 'addressLine2', label: 'Address line 2', required: false },
  { key: 'city', label: 'City', required: false },
  { key: 'state', label: 'State / province', required: false },
  { key: 'postalCode', label: 'Postal code', required: false },
  { key: 'country', label: 'Country', required: false },
  { key: 'tags', label: 'Tags (semicolon separated)', required: false },
  { key: 'notes', label: 'Notes', required: false },
] as const;

export type ClientImportField = (typeof CLIENT_IMPORT_FIELDS)[number]['key'];

export const importMappingSchema = z.record(z.string(), z.string().nullable());
