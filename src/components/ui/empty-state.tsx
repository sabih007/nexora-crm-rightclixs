import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Empty, error and "no permission" states.
 * Every list and detail view uses these rather than rendering a blank area,
 * so a user always knows whether there is no data, a failure, or no access.
 */

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'border-line bg-surface flex flex-col items-center justify-center rounded-xl border border-dashed text-center',
        compact ? 'px-5 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <div className="bg-surface-sunken text-ink-subtle flex size-11 items-center justify-center rounded-full">
        <Icon className="size-5" aria-hidden />
      </div>
      <h3 className="text-ink mt-3.5 text-sm font-semibold">{title}</h3>
      {description ? <p className="text-ink-subtle mt-1 max-w-sm text-sm">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  action,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'border-danger/25 bg-danger-soft flex flex-col items-center justify-center rounded-xl border px-6 py-10 text-center',
        className,
      )}
    >
      <AlertTriangle className="text-danger size-6" aria-hidden />
      <h3 className="text-ink mt-3 text-sm font-semibold">{title}</h3>
      {description ? <p className="text-ink-muted mt-1 max-w-md text-sm">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Shown when a role lacks the permission for a panel, instead of hiding it silently. */
export function NoAccessState({ what = 'this section' }: { what?: string }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="No access"
      description={`Your role does not include permission to view ${what}. Ask an administrator if you need it.`}
      compact
    />
  );
}

/** Inline callout used for disclosures (missing exchange rates, forecast caveats). */
export function Callout({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'border-info/25 bg-info-soft text-info',
    warning: 'border-warning/25 bg-warning-soft text-warning',
    danger: 'border-danger/25 bg-danger-soft text-danger',
    success: 'border-success/25 bg-success-soft text-success',
  } as const;

  return (
    <div className={cn('rounded-lg border px-3.5 py-2.5 text-sm', tones[tone], className)}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={cn('text-ink-muted', title && 'mt-0.5')}>{children}</div>
    </div>
  );
}
