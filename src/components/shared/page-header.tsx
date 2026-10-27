import * as React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Standard page chrome: breadcrumbs, title, supporting description, actions.
 * Used by every route so headings, spacing and landmark roles stay consistent.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  badge,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumbs?: Crumb[];
  actions?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6', className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="text-ink-subtle flex flex-wrap items-center gap-1 text-[13px]">
            {breadcrumbs.map((crumb, i) => {
              const isLast = i === breadcrumbs.length - 1;
              return (
                <li key={`${crumb.label}-${i}`} className="flex items-center gap-1">
                  {crumb.href && !isLast ? (
                    <Link
                      href={crumb.href}
                      className="hover:text-ink focus-visible:ring-brand-500/40 rounded transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span
                      aria-current={isLast ? 'page' : undefined}
                      className={isLast ? 'text-ink-muted' : ''}
                    >
                      {crumb.label}
                    </span>
                  )}
                  {!isLast ? <ChevronRight className="size-3.5 opacity-60" aria-hidden /> : null}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-ink text-xl font-semibold tracking-tight sm:text-[1.375rem]">
              {title}
            </h1>
            {badge}
          </div>
          {description ? (
            <p className="text-ink-muted mt-1 max-w-2xl text-sm">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="no-print flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

/** Secondary heading used inside a page for a group of content. */
export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-end justify-between gap-4', className)}>
      <div>
        <h2 className="text-ink text-sm font-semibold">{title}</h2>
        {description ? <p className="text-ink-subtle mt-0.5 text-xs">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
