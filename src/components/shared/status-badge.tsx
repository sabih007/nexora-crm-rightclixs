import * as React from 'react';
import type {
  CardStatus,
  ClientStatus,
  InvoiceStatus,
  LinkStatus,
  Priority,
  ProjectStatus,
  ScanStatus,
  SubscriptionStatus,
  TaskStatus,
} from '@/generated/prisma/enums';
import { Badge, type BadgeProps } from '@/components/ui/badge';

/**
 * One place that maps every domain status to a label and a colour tone,
 * so a status never renders differently in two parts of the app.
 */

type Tone = NonNullable<BadgeProps['tone']>;

const INVOICE: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SENT: { label: 'Sent', tone: 'info' },
  PARTIALLY_PAID: { label: 'Partially paid', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
  OVERDUE: { label: 'Overdue', tone: 'danger' },
  VOID: { label: 'Void', tone: 'outline' },
  CANCELLED: { label: 'Cancelled', tone: 'outline' },
};

const CLIENT: Record<ClientStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  PROSPECT: { label: 'Prospect', tone: 'info' },
  INACTIVE: { label: 'Inactive', tone: 'neutral' },
  ARCHIVED: { label: 'Archived', tone: 'outline' },
};

const PROJECT: Record<ProjectStatus, { label: string; tone: Tone }> = {
  PLANNING: { label: 'Planning', tone: 'neutral' },
  ACTIVE: { label: 'Active', tone: 'brand' },
  ON_HOLD: { label: 'On hold', tone: 'warning' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'outline' },
};

const TASK: Record<TaskStatus, { label: string; tone: Tone }> = {
  TODO: { label: 'To do', tone: 'neutral' },
  IN_PROGRESS: { label: 'In progress', tone: 'brand' },
  IN_REVIEW: { label: 'In review', tone: 'info' },
  DONE: { label: 'Done', tone: 'success' },
  BLOCKED: { label: 'Blocked', tone: 'danger' },
};

const PRIORITY: Record<Priority, { label: string; tone: Tone }> = {
  LOW: { label: 'Low', tone: 'neutral' },
  MEDIUM: { label: 'Medium', tone: 'info' },
  HIGH: { label: 'High', tone: 'warning' },
  URGENT: { label: 'Urgent', tone: 'danger' },
};

const SUBSCRIPTION: Record<SubscriptionStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  TRIAL: { label: 'Trial', tone: 'info' },
  PAUSED: { label: 'Paused', tone: 'warning' },
  CANCELLED: { label: 'Cancelled', tone: 'outline' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
};

const CARD: Record<CardStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  EXPIRED: { label: 'Expired', tone: 'warning' },
  BLOCKED: { label: 'Blocked', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'outline' },
};

const LINK: Record<LinkStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Saved on platform', tone: 'success' },
  REMOVED: { label: 'Removed', tone: 'outline' },
  UNKNOWN: { label: 'Unverified', tone: 'warning' },
};

const SCAN: Record<ScanStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Scan pending', tone: 'neutral' },
  CLEAN: { label: 'Clean', tone: 'success' },
  INFECTED: { label: 'Infected', tone: 'danger' },
  SKIPPED: { label: 'Not scanned', tone: 'warning' },
  FAILED: { label: 'Scan failed', tone: 'warning' },
};

const MAPS = {
  invoice: INVOICE,
  client: CLIENT,
  project: PROJECT,
  task: TASK,
  priority: PRIORITY,
  subscription: SUBSCRIPTION,
  card: CARD,
  link: LINK,
  scan: SCAN,
} as const;

export type StatusKind = keyof typeof MAPS;

export function StatusBadge({
  kind,
  value,
  size,
  className,
}: {
  kind: StatusKind;
  value: string;
  size?: BadgeProps['size'];
  className?: string;
}) {
  const map = MAPS[kind] as Record<string, { label: string; tone: Tone }>;
  const entry = map[value] ?? { label: value, tone: 'neutral' as Tone };
  return (
    <Badge tone={entry.tone} size={size} className={className} dot>
      {entry.label}
    </Badge>
  );
}

export function statusLabel(kind: StatusKind, value: string): string {
  const map = MAPS[kind] as Record<string, { label: string }>;
  return map[value]?.label ?? value;
}

/** Option lists for filter dropdowns, derived from the same source of truth. */
export function statusOptions(kind: StatusKind): { value: string; label: string }[] {
  return Object.entries(MAPS[kind]).map(([value, meta]) => ({
    value,
    label: (meta as { label: string }).label,
  }));
}
