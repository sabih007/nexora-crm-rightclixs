import { Decimal, dec, roundMoney, sum } from '@/lib/money';

/**
 * Subscription cadence and cost forecasting.
 *
 * ## What is a forecast and what is not
 *
 * Everything in this module is an **expected** charge derived from a
 * subscription's declared amount and schedule. None of it is money that has
 * left the account. Actual spend lives in the `Expense` table and is reported
 * separately — the two are never added together or substituted for each other.
 *
 * ## Monthly equivalent
 *
 * Per the specification:
 *   monthly   → amount
 *   quarterly → amount / 3
 *   annual    → amount / 12
 *   weekly    → amount × 52 / 12   (a year has 52.1775 weeks; 52 is the
 *                                   conventional, slightly conservative basis
 *                                   and is stated here rather than hidden)
 *   custom    → amount × (365.25 / intervalDays) / 12, i.e. the real schedule
 *               annualised then divided — never an invented average.
 *
 * Division is carried at full precision and rounded once, at the end.
 */

export type Cadence = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'WEEKLY' | 'CUSTOM_DAYS';

/** Days in a year used when annualising a custom cadence. */
const DAYS_PER_YEAR = new Decimal('365.25');
const WEEKS_PER_YEAR = new Decimal(52);

export interface SubscriptionSchedule {
  amount: string;
  currency: string;
  cadence: Cadence;
  intervalDays?: number | null;
  nextChargeAt: Date;
  startedAt?: Date | null;
  endsAt?: Date | null;
  status?: string;
  autoRenew?: boolean;
}

/** How many charges fall in a year under this cadence. */
export function chargesPerYear(cadence: Cadence, intervalDays?: number | null): Decimal {
  switch (cadence) {
    case 'MONTHLY':
      return new Decimal(12);
    case 'QUARTERLY':
      return new Decimal(4);
    case 'ANNUAL':
      return new Decimal(1);
    case 'WEEKLY':
      return WEEKS_PER_YEAR;
    case 'CUSTOM_DAYS': {
      if (!intervalDays || intervalDays <= 0) {
        throw new Error('A custom cadence requires a positive interval in days.');
      }
      return DAYS_PER_YEAR.dividedBy(intervalDays);
    }
    default: {
      const exhaustive: never = cadence;
      throw new Error(`Unhandled cadence: ${String(exhaustive)}`);
    }
  }
}

/** Cost per calendar month, rounded once to the currency's minor unit. */
export function monthlyEquivalent(schedule: SubscriptionSchedule): string {
  const perYear = chargesPerYear(schedule.cadence, schedule.intervalDays);
  const annual = dec(schedule.amount).times(perYear);
  return roundMoney(annual.dividedBy(12), schedule.currency).toString();
}

/** Total committed over twelve months at the current amount and cadence. */
export function annualizedCost(schedule: SubscriptionSchedule): string {
  const perYear = chargesPerYear(schedule.cadence, schedule.intervalDays);
  return roundMoney(dec(schedule.amount).times(perYear), schedule.currency).toString();
}

/** Advance a date by one billing period. */
export function advanceChargeDate(
  from: Date,
  cadence: Cadence,
  intervalDays?: number | null,
): Date {
  const next = new Date(from.getTime());

  switch (cadence) {
    case 'MONTHLY':
      return addMonthsAnchored(next, 1);
    case 'QUARTERLY':
      return addMonthsAnchored(next, 3);
    case 'ANNUAL':
      return addMonthsAnchored(next, 12);
    case 'WEEKLY':
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case 'CUSTOM_DAYS': {
      if (!intervalDays || intervalDays <= 0) {
        throw new Error('A custom cadence requires a positive interval in days.');
      }
      next.setUTCDate(next.getUTCDate() + intervalDays);
      return next;
    }
    default: {
      const exhaustive: never = cadence;
      throw new Error(`Unhandled cadence: ${String(exhaustive)}`);
    }
  }
}

/**
 * Add months while keeping the billing anchor.
 *
 * A subscription anchored on the 31st bills on the 30th in a 30-day month and
 * on the 28th/29th in February, but returns to the 31st afterwards — the same
 * behaviour real billing systems use. Naive date arithmetic would roll a
 * 31 January charge into 3 March.
 */
function addMonthsAnchored(date: Date, months: number): Date {
  const anchorDay = date.getUTCDate();
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 0, 0, 0, 0),
  );
  const daysInTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(anchorDay, daysInTargetMonth));
  return target;
}

export interface UpcomingCharge {
  subscriptionId: string;
  platformName: string;
  planName: string;
  amount: string;
  currency: string;
  chargeDate: Date;
  cardLabel: string | null;
  category: string;
}

export interface ForecastSubscription extends SubscriptionSchedule {
  id: string;
  platformName: string;
  planName: string;
  cardLabel?: string | null;
  category: string;
}

/**
 * Expected charges inside a window.
 *
 * Walks the real schedule forward from `nextChargeAt`, so a weekly plan
 * produces four or five entries in a month rather than one averaged figure.
 * Stops at `endsAt`, and skips subscriptions that are not actively billing.
 */
export function upcomingCharges(
  subscriptions: ForecastSubscription[],
  options: { from: Date; to: Date; maxPerSubscription?: number },
): UpcomingCharge[] {
  const { from, to, maxPerSubscription = 64 } = options;
  const charges: UpcomingCharge[] = [];

  for (const subscription of subscriptions) {
    if (!isBilling(subscription)) continue;

    let chargeDate = new Date(subscription.nextChargeAt.getTime());
    let emitted = 0;

    // Catch up to the window start without emitting past charges.
    while (chargeDate < from && emitted < maxPerSubscription) {
      chargeDate = advanceChargeDate(chargeDate, subscription.cadence, subscription.intervalDays);
      emitted += 1;
    }

    emitted = 0;
    while (chargeDate <= to && emitted < maxPerSubscription) {
      if (subscription.endsAt && chargeDate > subscription.endsAt) break;

      charges.push({
        subscriptionId: subscription.id,
        platformName: subscription.platformName,
        planName: subscription.planName,
        amount: roundMoney(subscription.amount, subscription.currency).toString(),
        currency: subscription.currency,
        chargeDate: new Date(chargeDate.getTime()),
        cardLabel: subscription.cardLabel ?? null,
        category: subscription.category,
      });

      // A non-renewing subscription bills once more and then stops.
      if (subscription.autoRenew === false) break;

      chargeDate = advanceChargeDate(chargeDate, subscription.cadence, subscription.intervalDays);
      emitted += 1;
    }
  }

  return charges.sort((a, b) => a.chargeDate.getTime() - b.chargeDate.getTime());
}

/** Only ACTIVE and TRIAL subscriptions generate expected charges. */
export function isBilling(subscription: { status?: string }): boolean {
  const status = subscription.status ?? 'ACTIVE';
  return status === 'ACTIVE' || status === 'TRIAL';
}

export interface CommitmentTotals {
  /** Monthly equivalent per currency. */
  monthlyByCurrency: Record<string, string>;
  /** Annualised commitment per currency. */
  annualByCurrency: Record<string, string>;
  activeCount: number;
}

/**
 * Recurring commitment, grouped by currency.
 * Unlike currencies are never summed — consolidation is a reporting concern
 * and requires a dated exchange rate.
 */
export function commitmentTotals(subscriptions: ForecastSubscription[]): CommitmentTotals {
  const monthly: Record<string, Decimal> = {};
  const annual: Record<string, Decimal> = {};
  let activeCount = 0;

  for (const subscription of subscriptions) {
    if (!isBilling(subscription)) continue;
    activeCount += 1;

    const currency = subscription.currency;
    monthly[currency] = (monthly[currency] ?? new Decimal(0)).plus(
      monthlyEquivalent(subscription),
    );
    annual[currency] = (annual[currency] ?? new Decimal(0)).plus(annualizedCost(subscription));
  }

  return {
    monthlyByCurrency: Object.fromEntries(
      Object.entries(monthly).map(([c, v]) => [c, roundMoney(v, c).toString()]),
    ),
    annualByCurrency: Object.fromEntries(
      Object.entries(annual).map(([c, v]) => [c, roundMoney(v, c).toString()]),
    ),
    activeCount,
  };
}

/** Sum a set of expected charges by currency. */
export function totalChargesByCurrency(charges: UpcomingCharge[]): Record<string, string> {
  const totals: Record<string, string[]> = {};
  for (const charge of charges) {
    (totals[charge.currency] ??= []).push(charge.amount);
  }
  return Object.fromEntries(
    Object.entries(totals).map(([currency, amounts]) => [
      currency,
      roundMoney(sum(amounts), currency).toString(),
    ]),
  );
}

/**
 * Last date to cancel without being charged again, given a notice period.
 * Returns null when the subscription declares no notice requirement.
 */
export function cancellationDeadline(
  nextChargeAt: Date,
  noticeDays?: number | null,
): Date | null {
  if (!noticeDays || noticeDays <= 0) return null;
  const deadline = new Date(nextChargeAt.getTime());
  deadline.setUTCDate(deadline.getUTCDate() - noticeDays);
  return deadline;
}

export const CADENCE_LABELS: Record<Cadence, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  ANNUAL: 'Annual',
  WEEKLY: 'Weekly',
  CUSTOM_DAYS: 'Custom',
};

export function cadenceLabel(cadence: Cadence, intervalDays?: number | null): string {
  if (cadence === 'CUSTOM_DAYS' && intervalDays) return `Every ${intervalDays} days`;
  return CADENCE_LABELS[cadence];
}
