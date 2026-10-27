'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { withSearchParams } from '@/lib/utils';

/** URL-driven pagination for the expenses list. */
export function ExpensePagination({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  function goTo(next: number) {
    router.push(`${pathname}${withSearchParams(searchParams, { page: next })}`, { scroll: false });
  }

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Expense pagination"
      className="text-ink-muted mt-3 flex items-center justify-between gap-3 text-[13px]"
    >
      <p>
        Showing <span className="tabular text-ink font-medium">{first}</span>–
        <span className="tabular text-ink font-medium">{last}</span> of{' '}
        <span className="tabular text-ink font-medium">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => goTo(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="tabular px-1">
          {page} / {totalPages}
        </span>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Next page"
          disabled={page >= totalPages}
          onClick={() => goTo(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
