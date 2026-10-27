'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
import { Input, Select } from '@/components/ui/field';
import { DATE_RANGE_PRESETS, type DateRangePreset } from '@/lib/dates';
import { withSearchParams } from '@/lib/utils';

/**
 * Date range picker driven entirely by the URL, so a filtered report is a
 * shareable link and the back button behaves.
 */
export function DateRangeControl({
  preset,
  from,
  to,
}: {
  preset: DateRangePreset;
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();

  function update(changes: Record<string, string | null>) {
    const next = withSearchParams(searchParams, changes);
    startTransition(() => router.push(`${pathname}${next}`, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <CalendarDays className="text-ink-subtle size-4" aria-hidden />

      <Select
        aria-label="Date range"
        value={preset}
        onChange={(e) =>
          update({
            range: e.target.value,
            // Clear custom bounds unless the custom preset was chosen.
            ...(e.target.value === 'custom' ? {} : { from: null, to: null }),
          })
        }
        className="h-9 w-auto"
      >
        {DATE_RANGE_PRESETS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      {preset === 'custom' ? (
        <>
          <Input
            type="date"
            value={from ?? ''}
            onChange={(e) => update({ from: e.target.value || null })}
            aria-label="From date"
            className="h-9 w-auto"
          />
          <span className="text-ink-subtle text-xs">to</span>
          <Input
            type="date"
            value={to ?? ''}
            onChange={(e) => update({ to: e.target.value || null })}
            aria-label="To date"
            className="h-9 w-auto"
          />
        </>
      ) : null}
    </div>
  );
}
