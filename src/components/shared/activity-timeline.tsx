import * as React from 'react';
import Link from 'next/link';
import { auditLabel } from '@/lib/audit-labels';
import { Avatar } from '@/components/ui/misc';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/utils';

export interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  createdAt: Date;
  actor: { id: string; name: string; avatarColor: string } | null;
}

/** Maps an audit entry to the page the entity lives on, where one exists. */
function entityHref(entry: ActivityEntry): string | null {
  if (!entry.entityId) return null;
  switch (entry.entityType) {
    case 'Client':
      return `/clients/${entry.entityId}`;
    case 'Project':
      return `/projects/${entry.entityId}`;
    case 'Invoice':
      return `/invoices/${entry.entityId}`;
    case 'Subscription':
      return `/subscriptions/${entry.entityId}`;
    default:
      return null;
  }
}

const ACTION_TONE: Record<string, string> = {
  created: 'bg-success',
  issued: 'bg-brand-500',
  updated: 'bg-info',
  deleted: 'bg-danger',
  voided: 'bg-danger',
  archived: 'bg-warning',
  removed: 'bg-warning',
};

function toneFor(action: string): string {
  const verb = action.split('.')[1] ?? '';
  for (const [key, tone] of Object.entries(ACTION_TONE)) {
    if (verb.includes(key)) return tone;
  }
  return 'bg-line-strong';
}

/**
 * Audit-derived activity feed.
 * Shows what happened, who did it and when — the same records the Activity
 * Log page reads, filtered to one entity.
 */
export function ActivityTimeline({
  entries,
  emptyMessage = 'No recorded activity yet.',
  className,
}: {
  entries: ActivityEntry[];
  emptyMessage?: string;
  className?: string;
}) {
  if (entries.length === 0) {
    return <EmptyState title="Nothing recorded" description={emptyMessage} compact />;
  }

  return (
    <ol className={cn('relative space-y-0', className)}>
      {entries.map((entry, index) => {
        const href = entityHref(entry);
        const isLast = index === entries.length - 1;

        return (
          <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
            {!isLast ? (
              <span
                className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-line"
                aria-hidden
              />
            ) : null}

            <span className="relative mt-1 flex size-6 shrink-0 items-center justify-center">
              <span className={cn('size-2 rounded-full ring-4 ring-[var(--surface)]', toneFor(entry.action))} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-ink">
                <span className="font-medium">{auditLabel(entry.action)}</span>
                {entry.summary ? (
                  <>
                    {' — '}
                    {href ? (
                      <Link href={href} className="text-brand-500 hover:underline">
                        {entry.summary}
                      </Link>
                    ) : (
                      <span className="text-ink-muted">{entry.summary}</span>
                    )}
                  </>
                ) : null}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-subtle">
                {entry.actor ? (
                  <>
                    <Avatar name={entry.actor.name} color={entry.actor.avatarColor} size="xs" />
                    <span>{entry.actor.name}</span>
                    <span aria-hidden>·</span>
                  </>
                ) : (
                  <>
                    <span>System</span>
                    <span aria-hidden>·</span>
                  </>
                )}
                <time dateTime={new Date(entry.createdAt).toISOString()}>
                  {formatDateTime(entry.createdAt)}
                </time>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
