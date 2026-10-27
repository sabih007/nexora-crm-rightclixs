import { CurrencyAmount } from '@/components/shared/currency-amount';
import { cn } from '@/lib/utils';

/**
 * Renders a per-currency total map.
 *
 * Unlike currencies are listed side by side rather than summed — converting
 * them needs a dated exchange rate and belongs in Reports, where the rate and
 * its source are disclosed.
 */
export function MultiCurrencyAmount({
  amounts,
  className,
  emptyLabel = '—',
  size = 'xl',
}: {
  amounts: Record<string, string>;
  className?: string;
  emptyLabel?: string;
  size?: 'md' | 'lg' | 'xl';
}) {
  const entries = Object.entries(amounts).filter(([, value]) => Number(value) !== 0);

  if (entries.length === 0) {
    return <span className={cn('text-ink-subtle', className)}>{emptyLabel}</span>;
  }

  if (entries.length === 1) {
    const [currency, amount] = entries[0] as [string, string];
    return <CurrencyAmount amount={amount} currency={currency} size={size} className={className} />;
  }

  return (
    <span className={cn('flex flex-col gap-0.5', className)}>
      {entries.map(([currency, amount]) => (
        <CurrencyAmount
          key={currency}
          amount={amount}
          currency={currency}
          size={entries.length > 2 ? 'md' : 'lg'}
        />
      ))}
    </span>
  );
}
