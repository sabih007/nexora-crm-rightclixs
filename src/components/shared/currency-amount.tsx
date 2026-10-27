import * as React from 'react';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * Renders a monetary value.
 *
 * Amounts arrive from the server as exact decimal **strings** (never floats).
 * The component formats for display only; it never does arithmetic.
 */
export function CurrencyAmount({
  amount,
  currency,
  className,
  compact = false,
  signed = false,
  muted = false,
  tone,
  size = 'md',
}: {
  amount: string | number | null | undefined;
  currency: string;
  className?: string;
  /** Abbreviate large values (1.2M) — for dashboard tiles, never for invoices. */
  compact?: boolean;
  /** Prefix a + for positive values. */
  signed?: boolean;
  muted?: boolean;
  tone?: 'positive' | 'negative' | 'neutral';
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const raw = amount ?? 0;
  const numeric = typeof raw === 'string' ? Number.parseFloat(raw) : raw;
  const formatted = formatMoney(typeof raw === 'number' ? raw : raw.toString(), currency, {
    compact,
  });

  const resolvedTone = tone ?? (Number.isFinite(numeric) && numeric < 0 ? 'negative' : undefined);

  const sizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-lg font-semibold',
    xl: 'text-2xl font-semibold tracking-tight',
  } as const;

  return (
    <span
      className={cn(
        'tabular whitespace-nowrap',
        sizes[size],
        muted && 'text-ink-subtle',
        resolvedTone === 'positive' && 'text-success',
        resolvedTone === 'negative' && 'text-danger',
        className,
      )}
      title={`${currency} ${raw}`}
    >
      {signed && Number.isFinite(numeric) && numeric > 0 ? '+' : ''}
      {formatted}
    </span>
  );
}

/**
 * Shows an amount in its original currency with the converted value beneath.
 * Used in consolidated reports so the source figure is never hidden.
 */
export function ConvertedAmount({
  amount,
  currency,
  convertedAmount,
  baseCurrency,
  rateNote,
  className,
}: {
  amount: string;
  currency: string;
  convertedAmount: string | null;
  baseCurrency: string;
  rateNote?: string;
  className?: string;
}) {
  const sameCurrency = currency.toUpperCase() === baseCurrency.toUpperCase();
  return (
    <span className={cn('inline-flex flex-col items-end leading-tight', className)}>
      <CurrencyAmount amount={amount} currency={currency} />
      {!sameCurrency ? (
        convertedAmount !== null ? (
          <span className="text-ink-subtle tabular text-[11px]" title={rateNote}>
            ≈ {formatMoney(convertedAmount, baseCurrency)}
          </span>
        ) : (
          <span
            className="text-warning text-[11px]"
            title="No exchange rate on or before this date"
          >
            no rate
          </span>
        )
      ) : null}
    </span>
  );
}
