'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Callout, EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CURRENCIES, PRIORITY_CURRENCIES } from '@/lib/money';
import { formatDate, toDateInput } from '@/lib/dates';
import { addExchangeRate, deleteExchangeRate } from './actions';

interface RateRow {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  effectiveDate: Date;
  source: string;
}

export function ExchangeRatesManager({
  rates,
  baseCurrency,
  canManage,
}: {
  rates: RateRow[];
  baseCurrency: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [from, setFrom] = React.useState('USD');
  const [to, setTo] = React.useState(baseCurrency);
  const [rate, setRate] = React.useState('');
  const [effectiveDate, setEffectiveDate] = React.useState(toDateInput(new Date()));
  const [source, setSource] = React.useState('manual');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<RateRow | null>(null);

  const valid =
    /^\d+(\.\d{1,10})?$/.test(rate) && Number(rate) > 0 && from !== to && effectiveDate !== '';

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await addExchangeRate({
        baseCurrency: from,
        quoteCurrency: to,
        rate,
        effectiveDate,
        source,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success('Rate saved');
      setRate('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const result = await deleteExchangeRate({ id: deleteTarget.id });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Rate removed');
    setDeleteTarget(null);
    router.refresh();
  }

  // Group by pair so the history of each one reads as a timeline.
  const grouped = React.useMemo(() => {
    const map = new Map<string, RateRow[]>();
    for (const row of rates) {
      const key = `${row.baseCurrency}→${row.quoteCurrency}`;
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime());
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rates]);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0">
        {grouped.length === 0 ? (
          <EmptyState
            title="No exchange rates recorded"
            description={`Without rates, transactions in a currency other than ${baseCurrency} are reported separately rather than converted.`}
          />
        ) : (
          <div className="space-y-4">
            {grouped.map(([pair, rows]) => (
              <Card key={pair}>
                <CardHeader>
                  <CardTitle className="font-mono">{pair}</CardTitle>
                  <Badge tone="outline" size="sm">
                    {rows.length} snapshot{rows.length === 1 ? '' : 's'}
                  </Badge>
                </CardHeader>
                <CardContent className="p-0">
                  <ul className="divide-y divide-[var(--line)]">
                    {rows.map((row, index) => (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5"
                      >
                        <span className="w-24 shrink-0 text-[13px] text-ink">
                          {formatDate(row.effectiveDate)}
                        </span>
                        <span className="tabular text-sm font-medium text-ink">
                          1 {row.baseCurrency} = {row.rate} {row.quoteCurrency}
                        </span>
                        <Badge tone="outline" size="sm">
                          {row.source}
                        </Badge>
                        {index === 0 ? (
                          <Badge tone="success" size="sm">
                            latest
                          </Badge>
                        ) : null}
                        {canManage ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="ml-auto"
                            aria-label={`Delete the ${pair} rate effective ${formatDate(row.effectiveDate)}`}
                            onClick={() => setDeleteTarget(row)}
                          >
                            <Trash2 className="text-danger" />
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {canManage ? (
        <aside>
          <Card>
            <CardHeader>
              <CardTitle>Add a rate</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAdd} className="space-y-3.5">
                {error ? <Callout tone="danger">{error}</Callout> : null}

                <Field label="From currency" required htmlFor="rate-from">
                  <Select id="rate-from" value={from} onChange={(e) => setFrom(e.target.value)}>
                    <optgroup label="Common">
                      {PRIORITY_CURRENCIES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="All currencies">
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </optgroup>
                  </Select>
                </Field>

                <Field label="To currency" required htmlFor="rate-to">
                  <Select id="rate-to" value={to} onChange={(e) => setTo(e.target.value)}>
                    <optgroup label="Common">
                      {PRIORITY_CURRENCIES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="All currencies">
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </optgroup>
                  </Select>
                </Field>

                <Field
                  label="Rate"
                  required
                  htmlFor="rate-value"
                  hint={`How many ${to} one ${from} buys.`}
                >
                  <Input
                    id="rate-value"
                    inputMode="decimal"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    placeholder="278.50"
                    className="text-right tabular"
                  />
                </Field>

                <Field
                  label="Effective from"
                  required
                  htmlFor="rate-date"
                  hint="Applies to transactions on or after this date, until a newer rate."
                >
                  <Input
                    id="rate-date"
                    type="date"
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                  />
                </Field>

                <Field
                  label="Source"
                  htmlFor="rate-source"
                  hint="Recorded alongside the rate and shown in reports."
                >
                  <Input
                    id="rate-source"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="manual, bank statement, …"
                  />
                </Field>

                <Button type="submit" className="w-full" loading={busy} disabled={!valid}>
                  <Plus /> Save rate
                </Button>

                {from === to ? (
                  <p className="text-xs text-warning">Choose two different currencies.</p>
                ) : null}
              </form>
            </CardContent>
          </Card>
        </aside>
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        title="Delete this rate?"
        description="Reports covering dates that relied on it will fall back to an earlier rate, or report those amounts as unconvertible."
        confirmLabel="Delete rate"
        onConfirm={handleDelete}
      />
    </div>
  );
}
