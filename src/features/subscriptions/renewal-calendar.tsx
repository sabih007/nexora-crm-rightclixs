'use client';

import * as React from 'react';
import Link from 'next/link';
import { CalendarDays, CreditCard } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { CurrencyAmount } from '@/components/shared/currency-amount';
import { MultiCurrencyAmount } from './multi-currency-amount';
import { daysUntil } from '@/lib/dates';
import { cn } from '@/lib/utils';

interface SerializedCharge {
  subscriptionId: string;
  platformName: string;
  planName: string;
  amount: string;
  currency: string;
  chargeDate: string;
  cardLabel: string | null;
  category: string;
}

/**
 * Renewal calendar.
 *
 * Grouped by calendar month and then by day, so "what is due next?" is
 * answerable at a glance. Every row is an expected charge from the schedule.
 */
export function RenewalCalendar({
  charges,
  totals,
}: {
  charges: SerializedCharge[];
  totals: {
    next7: Record<string, string>;
    next30: Record<string, string>;
    next90: Record<string, string>;
  };
}) {
  const grouped = React.useMemo(() => {
    const months = new Map<string, Map<string, SerializedCharge[]>>();
    for (const charge of charges) {
      const date = new Date(charge.chargeDate);
      const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      const dayKey = charge.chargeDate.slice(0, 10);
      const month = months.get(monthKey) ?? new Map<string, SerializedCharge[]>();
      const day = month.get(dayKey) ?? [];
      day.push(charge);
      month.set(dayKey, day);
      months.set(monthKey, month);
    }
    return [...months.entries()];
  }, [charges]);

  if (charges.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No charges expected in the next 90 days"
        description="Active subscriptions with a next charge date inside the window will appear here."
      />
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_16rem]">
      <div className="min-w-0 space-y-5">
        {grouped.map(([monthKey, days]) => {
          const monthDate = new Date(`${monthKey}-01T00:00:00Z`);
          const monthLabel = monthDate.toLocaleDateString('en-GB', {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          });

          const monthTotals: Record<string, number> = {};
          for (const dayCharges of days.values()) {
            for (const charge of dayCharges) {
              monthTotals[charge.currency] =
                (monthTotals[charge.currency] ?? 0) + Number(charge.amount);
            }
          }

          return (
            <section key={monthKey}>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-ink text-sm font-semibold">{monthLabel}</h2>
                <span className="text-ink-subtle text-xs">
                  expected{' '}
                  <MultiCurrencyAmount
                    amounts={Object.fromEntries(
                      Object.entries(monthTotals).map(([c, v]) => [c, v.toFixed(2)]),
                    )}
                    size="md"
                    className="inline-flex flex-row gap-2"
                  />
                </span>
              </div>

              <Card>
                <CardContent className="p-0">
                  <ul className="divide-y divide-[var(--line)]">
                    {[...days.entries()].map(([dayKey, dayCharges]) => {
                      const days0 = daysUntil(new Date(`${dayKey}T00:00:00Z`));
                      const imminent = days0 >= 0 && days0 <= 7;

                      return (
                        <li key={dayKey} className="flex gap-4 px-4 py-3">
                          <div className="w-14 shrink-0 text-center">
                            <div
                              className={cn(
                                'rounded-lg border px-1.5 py-1',
                                imminent
                                  ? 'border-warning/30 bg-warning-soft'
                                  : 'border-line bg-surface-sunken',
                              )}
                            >
                              <span className="text-ink-subtle block text-[10px] tracking-wide uppercase">
                                {new Date(`${dayKey}T00:00:00Z`).toLocaleDateString('en-GB', {
                                  weekday: 'short',
                                  timeZone: 'UTC',
                                })}
                              </span>
                              <span
                                className={cn(
                                  'tabular block text-lg leading-tight font-semibold',
                                  imminent ? 'text-warning' : 'text-ink',
                                )}
                              >
                                {new Date(`${dayKey}T00:00:00Z`).getUTCDate()}
                              </span>
                            </div>
                            <span className="text-ink-subtle mt-0.5 block text-[10px]">
                              {days0 === 0 ? 'today' : days0 === 1 ? 'tomorrow' : `in ${days0}d`}
                            </span>
                          </div>

                          <ul className="min-w-0 flex-1 space-y-1.5">
                            {dayCharges.map((charge, index) => (
                              <li
                                key={`${charge.subscriptionId}-${index}`}
                                className="flex flex-wrap items-center gap-x-3 gap-y-1"
                              >
                                <Link
                                  href={`/subscriptions/${charge.subscriptionId}`}
                                  className="text-ink hover:text-brand-500 truncate text-sm font-medium hover:underline"
                                >
                                  {charge.platformName}
                                </Link>
                                <span className="text-ink-subtle truncate text-xs">
                                  {charge.planName}
                                </span>
                                <Badge tone="outline" size="sm">
                                  {charge.category}
                                </Badge>
                                {charge.cardLabel ? (
                                  <span className="text-ink-subtle inline-flex items-center gap-1 text-[11px]">
                                    <CreditCard className="size-3" aria-hidden />
                                    {charge.cardLabel}
                                  </span>
                                ) : (
                                  <span className="text-warning text-[11px]">no card linked</span>
                                )}
                                <CurrencyAmount
                                  amount={charge.amount}
                                  currency={charge.currency}
                                  className="ml-auto font-medium"
                                />
                              </li>
                            ))}
                          </ul>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            </section>
          );
        })}
      </div>

      <aside className="space-y-3">
        {(
          [
            ['Next 7 days', totals.next7],
            ['Next 30 days', totals.next30],
            ['Next 90 days', totals.next90],
          ] as const
        ).map(([label, amounts]) => (
          <Card key={label}>
            <CardContent className="pt-4">
              <p className="text-ink-subtle text-xs">{label}</p>
              <MultiCurrencyAmount amounts={amounts} size="lg" className="mt-1" />
              <p className="text-ink-subtle mt-1.5 text-[11px]">Expected, not yet paid.</p>
            </CardContent>
          </Card>
        ))}
      </aside>
    </div>
  );
}
