import { cache } from 'react';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';

/**
 * Workspace access.
 *
 * v1 runs a single office workspace, but nothing in the codebase assumes
 * that: every query takes a workspaceId and this module is the only place
 * that resolves "the" workspace.
 */

export interface WorkspaceSummary {
  id: string;
  name: string;
  baseCurrency: string;
  timezone: string;
  invoicePrefix: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
}

export const getWorkspace = cache(async (workspaceId: string): Promise<WorkspaceSummary> => {
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: {
      id: true,
      name: true,
      baseCurrency: true,
      timezone: true,
      invoicePrefix: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      postalCode: true,
      country: true,
      taxId: true,
      email: true,
      phone: true,
    },
  });
  return ws;
});

/** The single workspace, creating it on first run if the database is empty. */
export async function ensureWorkspace(): Promise<string> {
  const existing = await prisma.workspace.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } });
  if (existing) return existing.id;

  const created = await prisma.workspace.create({
    data: {
      name: env.WORKSPACE_NAME,
      baseCurrency: env.WORKSPACE_BASE_CURRENCY,
      timezone: env.WORKSPACE_TIMEZONE,
    },
    select: { id: true },
  });
  return created.id;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface WorkspaceSettings {
  /** Days after the issue date an invoice is due by default. */
  defaultPaymentTermDays: number;
  /** Default tax rate applied to new invoice lines, as a percentage. */
  defaultTaxRate: string;
  /** Text appended to every new invoice. */
  defaultInvoiceTerms: string;
  defaultInvoiceNotes: string;
  /** Number of digits in the sequential part of an invoice number. */
  invoiceNumberPadding: number;
  /** Include the issue year in generated invoice numbers. */
  invoiceNumberIncludeYear: boolean;
  /** Days before renewal that reminders fire. */
  renewalReminderDays: number[];
  /** Days after due date that an overdue reminder fires. */
  invoiceReminderDays: number[];
}

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  defaultPaymentTermDays: 14,
  defaultTaxRate: '0',
  defaultInvoiceTerms: 'Payment is due within the stated terms. Late payments may incur charges.',
  defaultInvoiceNotes: '',
  invoiceNumberPadding: 4,
  invoiceNumberIncludeYear: true,
  renewalReminderDays: [30, 14, 7, 1],
  invoiceReminderDays: [1, 7, 14],
};

const SETTINGS_KEY = 'workspace';

export const getWorkspaceSettings = cache(async (workspaceId: string): Promise<WorkspaceSettings> => {
  const row = await prisma.setting.findUnique({
    where: { workspaceId_key: { workspaceId, key: SETTINGS_KEY } },
    select: { valueJson: true },
  });
  if (!row) return DEFAULT_SETTINGS;
  // Merge so a setting added in a later release has a sane default for
  // workspaces created before it existed.
  return { ...DEFAULT_SETTINGS, ...(row.valueJson as Partial<WorkspaceSettings>) };
});

export async function saveWorkspaceSettings(
  workspaceId: string,
  patch: Partial<WorkspaceSettings>,
): Promise<WorkspaceSettings> {
  const current = await getWorkspaceSettings(workspaceId);
  const next = { ...current, ...patch };
  await prisma.setting.upsert({
    where: { workspaceId_key: { workspaceId, key: SETTINGS_KEY } },
    create: { workspaceId, key: SETTINGS_KEY, valueJson: next },
    update: { valueJson: next },
  });
  return next;
}
