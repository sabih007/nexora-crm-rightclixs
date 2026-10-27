import * as React from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Info } from 'lucide-react';
import { Tooltip } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

/**
 * KPI tile.
 *
 * Deliberately a *server* component. It needs no client state, and keeping
 * it on the server lets a page pass an icon component (`icon={Banknote}`)
 * directly — a function cannot cross the server/client boundary, so marking
 * this 'use client' would break every page that supplies an icon.
 *
 * Every tile must carry a `definition` — the exact rule used to compute the
 * number. A figure on this dashboard is never shown without the user being
 * able to find out what it actually counts.
 */
export function StatCard({
  label,
  value,
  definition,
  sublabel,
  delta,
  tone = 'default',
  href,
  icon: Icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** Plain-language calculation rule, surfaced through the info affordance. */
  definition: string;
  sublabel?: React.ReactNode;
  delta?: { value: number; label: string } | null;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'brand';
  href?: string;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  const tones = {
    default: 'text-ink',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    brand: 'text-brand-500',
  } as const;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-ink-muted text-[13px] font-medium">{label}</span>
          <Tooltip content={definition}>
            <button
              type="button"
              aria-label={`How ${label} is calculated: ${definition}`}
              className="text-ink-subtle hover:text-ink focus-visible:ring-brand-500/40 rounded transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <Info className="size-3.5" aria-hidden />
            </button>
          </Tooltip>
        </div>
        {Icon ? <Icon className="text-ink-subtle size-4 shrink-0" /> : null}
      </div>

      <div className={cn('tabular mt-2 text-2xl font-semibold tracking-tight', tones[tone])}>
        {value}
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-xs">
        {delta ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 font-medium',
              delta.value > 0 && 'text-success',
              delta.value < 0 && 'text-danger',
              delta.value === 0 && 'text-ink-subtle',
            )}
          >
            {delta.value > 0 ? (
              <ArrowUpRight className="size-3.5" aria-hidden />
            ) : delta.value < 0 ? (
              <ArrowDownRight className="size-3.5" aria-hidden />
            ) : null}
            {Math.abs(delta.value).toFixed(1)}%
            <span className="text-ink-subtle font-normal"> {delta.label}</span>
          </span>
        ) : null}
        {sublabel ? <span className="text-ink-subtle">{sublabel}</span> : null}
      </div>
    </>
  );

  const classes = cn(
    'rounded-xl border border-line bg-surface p-4 shadow-xs transition-shadow',
    href && 'group hover:shadow-md',
    className,
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          classes,
          'focus-visible:ring-brand-500/40 block focus-visible:ring-2 focus-visible:outline-none',
        )}
      >
        {body}
        <span className="text-brand-500 mt-2 inline-flex items-center gap-1 text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100">
          View <ArrowRight className="size-3" aria-hidden />
        </span>
      </Link>
    );
  }

  return <div className={classes}>{body}</div>;
}

/** Responsive grid for a row of KPI tiles. */
export function StatGrid({
  children,
  className,
  columns = 4,
}: {
  children: React.ReactNode;
  className?: string;
  columns?: 2 | 3 | 4;
}) {
  const cols = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 xl:grid-cols-4',
  } as const;
  return <div className={cn('grid grid-cols-1 gap-3', cols[columns], className)}>{children}</div>;
}
