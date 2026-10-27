import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import type { AuthContext } from '@/lib/auth/session';
import { escapeLike, type PaginatedResult, type Pagination, skipTake } from '@/lib/query';
import { addDays, todayUtc } from '@/lib/dates';
import {
  cancellationDeadline,
  commitmentTotals,
  monthlyEquivalent,
  totalChargesByCurrency,
  upcomingCharges,
  type ForecastSubscription,
} from './forecast';
import type { SubscriptionFilters, SubscriptionSortKey } from './schemas';

/** Card, platform and subscription read models. */

export interface SubscriptionListRow {
  id: string;
  planName: string;
  amount: string;
  currency: string;
  cadence: string;
  intervalDays: number | null;
  nextChargeAt: Date;
  status: string;
  category: string;
  autoRenew: boolean;
  noticeDays: number | null;
  monthlyEquivalent: string;
  cancelBy: Date | null;
  platform: { id: string; name: string; category: string };
  card: { id: string; nickname: string; last4: string; brand: string } | null;
  client: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
}

function buildWhere(
  ctx: AuthContext,
  filters: SubscriptionFilters,
): Prisma.SubscriptionWhereInput {
  const where: Prisma.SubscriptionWhereInput = { workspaceId: ctx.workspaceId };
  const and: Prisma.SubscriptionWhereInput[] = [];

  if (filters.search) {
    const term = escapeLike(filters.search);
    and.push({
      OR: [
        { planName: { contains: term, mode: 'insensitive' } },
        { platform: { name: { contains: term, mode: 'insensitive' } } },
        { category: { contains: term, mode: 'insensitive' } },
      ],
    });
  }
  if (filters.status.length > 0) and.push({ status: { in: filters.status } });
  if (filters.cadence.length > 0) and.push({ cadence: { in: filters.cadence } });
  if (filters.cardId) and.push({ cardId: filters.cardId });
  if (filters.platformId) and.push({ platformId: filters.platformId });
  if (filters.currency) and.push({ currency: filters.currency });
  if (filters.category) and.push({ category: filters.category });
  if (filters.ownerId) and.push({ platform: { ownerId: filters.ownerId } });
  if (filters.dueWithinDays !== undefined) {
    and.push({ nextChargeAt: { lte: addDays(todayUtc(), filters.dueWithinDays) } });
  }

  if (and.length > 0) where.AND = and;
  return where;
}

const SORT_FIELDS: Record<SubscriptionSortKey, keyof Prisma.SubscriptionOrderByWithRelationInput> =
  {
    nextChargeAt: 'nextChargeAt',
    planName: 'planName',
    amount: 'amount',
    status: 'status',
    category: 'category',
  };

const LIST_SELECT = {
  id: true,
  planName: true,
  amount: true,
  currency: true,
  cadence: true,
  intervalDays: true,
  nextChargeAt: true,
  startedAt: true,
  endsAt: true,
  status: true,
  category: true,
  autoRenew: true,
  noticeDays: true,
  platform: { select: { id: true, name: true, category: true } },
  card: { select: { id: true, nickname: true, last4: true, brand: true } },
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
} satisfies Prisma.SubscriptionSelect;

type SubscriptionRecord = Prisma.SubscriptionGetPayload<{ select: typeof LIST_SELECT }>;

function toListRow(sub: SubscriptionRecord): SubscriptionListRow {
  return {
    id: sub.id,
    planName: sub.planName,
    amount: sub.amount.toString(),
    currency: sub.currency,
    cadence: sub.cadence,
    intervalDays: sub.intervalDays,
    nextChargeAt: sub.nextChargeAt,
    status: sub.status,
    category: sub.category,
    autoRenew: sub.autoRenew,
    noticeDays: sub.noticeDays,
    monthlyEquivalent: monthlyEquivalent({
      amount: sub.amount.toString(),
      currency: sub.currency,
      cadence: sub.cadence,
      intervalDays: sub.intervalDays,
      nextChargeAt: sub.nextChargeAt,
    }),
    cancelBy: cancellationDeadline(sub.nextChargeAt, sub.noticeDays),
    platform: sub.platform,
    card: sub.card,
    client: sub.client,
    project: sub.project,
  };
}

function toForecastInput(sub: SubscriptionRecord): ForecastSubscription {
  return {
    id: sub.id,
    platformName: sub.platform.name,
    planName: sub.planName,
    amount: sub.amount.toString(),
    currency: sub.currency,
    cadence: sub.cadence,
    intervalDays: sub.intervalDays,
    nextChargeAt: sub.nextChargeAt,
    startedAt: sub.startedAt,
    endsAt: sub.endsAt,
    status: sub.status,
    autoRenew: sub.autoRenew,
    category: sub.category,
    cardLabel: sub.card ? `${sub.card.nickname} ···· ${sub.card.last4}` : null,
  };
}

export async function listSubscriptions(
  ctx: AuthContext,
  filters: SubscriptionFilters,
  pagination: Pagination,
  sort: { key: SubscriptionSortKey; direction: 'asc' | 'desc' },
): Promise<PaginatedResult<SubscriptionListRow>> {
  const where = buildWhere(ctx, filters);

  const [rows, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      orderBy: { [SORT_FIELDS[sort.key]]: sort.direction },
      ...skipTake(pagination),
      select: LIST_SELECT,
    }),
    prisma.subscription.count({ where }),
  ]);

  return {
    rows: rows.map(toListRow),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

/** Every subscription in scope, used by the forecast and dashboard panels. */
export async function allSubscriptionsForForecast(
  ctx: AuthContext,
): Promise<ForecastSubscription[]> {
  const rows = await prisma.subscription.findMany({
    where: { workspaceId: ctx.workspaceId },
    select: LIST_SELECT,
  });
  return rows.map(toForecastInput);
}

export interface ForecastSummary {
  commitment: ReturnType<typeof commitmentTotals>;
  next7: Record<string, string>;
  next30: Record<string, string>;
  next90: Record<string, string>;
  upcoming: ReturnType<typeof upcomingCharges>;
}

/**
 * Expected spend over the next 7/30/90 days, plus the renewal calendar.
 * Everything here is a forecast — actual paid expenses are reported from the
 * Expense table and are never mixed in.
 */
export async function getForecastSummary(ctx: AuthContext): Promise<ForecastSummary> {
  const subscriptions = await allSubscriptionsForForecast(ctx);
  const today = todayUtc();

  const in7 = upcomingCharges(subscriptions, { from: today, to: addDays(today, 7) });
  const in30 = upcomingCharges(subscriptions, { from: today, to: addDays(today, 30) });
  const in90 = upcomingCharges(subscriptions, { from: today, to: addDays(today, 90) });

  return {
    commitment: commitmentTotals(subscriptions),
    next7: totalChargesByCurrency(in7),
    next30: totalChargesByCurrency(in30),
    next90: totalChargesByCurrency(in90),
    upcoming: in90,
  };
}

export async function getSubscriptionDetail(ctx: AuthContext, subscriptionId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: { id: subscriptionId, workspaceId: ctx.workspaceId },
    include: {
      platform: true,
      card: { select: { id: true, nickname: true, last4: true, brand: true, status: true } },
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      expenses: { orderBy: { paidAt: 'desc' }, take: 24 },
      reminders: { orderBy: { sentAt: 'desc' }, take: 10 },
    },
  });
  if (!subscription) return null;

  const schedule = {
    amount: subscription.amount.toString(),
    currency: subscription.currency,
    cadence: subscription.cadence,
    intervalDays: subscription.intervalDays,
    nextChargeAt: subscription.nextChargeAt,
  };

  return {
    ...subscription,
    monthlyEquivalent: monthlyEquivalent(schedule),
    cancelBy: cancellationDeadline(subscription.nextChargeAt, subscription.noticeDays),
  };
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export interface CardWithFootprint {
  id: string;
  nickname: string;
  issuer: string;
  brand: string;
  last4: string;
  expiryMonth: number | null;
  expiryYear: number | null;
  status: string;
  notes: string | null;
  owner: { id: string; name: string } | null;
  /** Platforms this card is recorded as saved on. */
  activePlatforms: { linkId: string; platformId: string; name: string; lastVerifiedAt: Date | null }[];
  removedPlatforms: { linkId: string; platformId: string; name: string; removedAt: Date | null }[];
  unverifiedPlatforms: { linkId: string; platformId: string; name: string }[];
  subscriptionCount: number;
  monthlyByCurrency: Record<string, string>;
  /** True when the stored expiry is in the past. */
  isExpired: boolean;
}

/** Card inventory with the "where is this card saved?" footprint. */
export async function listCardsWithFootprint(ctx: AuthContext): Promise<CardWithFootprint[]> {
  const cards = await prisma.paymentCard.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: [{ status: 'asc' }, { nickname: 'asc' }],
    include: {
      owner: { select: { id: true, name: true } },
      platformLinks: {
        include: { platform: { select: { id: true, name: true } } },
        orderBy: { platform: { name: 'asc' } },
      },
      subscriptions: {
        select: {
          amount: true,
          currency: true,
          cadence: true,
          intervalDays: true,
          nextChargeAt: true,
          status: true,
        },
      },
    },
  });

  const now = todayUtc();

  return cards.map((card) => {
    const monthly: Record<string, string> = {};
    for (const sub of card.subscriptions) {
      if (sub.status !== 'ACTIVE' && sub.status !== 'TRIAL') continue;
      const equivalent = monthlyEquivalent({
        amount: sub.amount.toString(),
        currency: sub.currency,
        cadence: sub.cadence,
        intervalDays: sub.intervalDays,
        nextChargeAt: sub.nextChargeAt,
      });
      const current = monthly[sub.currency];
      monthly[sub.currency] = current
        ? (Number(current) + Number(equivalent)).toFixed(2)
        : equivalent;
    }

    const isExpired =
      card.expiryYear !== null &&
      card.expiryMonth !== null &&
      new Date(Date.UTC(card.expiryYear, card.expiryMonth, 0)) < now;

    return {
      id: card.id,
      nickname: card.nickname,
      issuer: card.issuer,
      brand: card.brand,
      last4: card.last4,
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear,
      status: card.status,
      notes: card.notes,
      owner: card.owner,
      activePlatforms: card.platformLinks
        .filter((l) => l.status === 'ACTIVE')
        .map((l) => ({
          linkId: l.id,
          platformId: l.platform.id,
          name: l.platform.name,
          lastVerifiedAt: l.lastVerifiedAt,
        })),
      removedPlatforms: card.platformLinks
        .filter((l) => l.status === 'REMOVED')
        .map((l) => ({
          linkId: l.id,
          platformId: l.platform.id,
          name: l.platform.name,
          removedAt: l.removedAt,
        })),
      unverifiedPlatforms: card.platformLinks
        .filter((l) => l.status === 'UNKNOWN')
        .map((l) => ({ linkId: l.id, platformId: l.platform.id, name: l.platform.name })),
      subscriptionCount: card.subscriptions.length,
      monthlyByCurrency: monthly,
      isExpired,
    };
  });
}

export async function listCardOptions(ctx: AuthContext) {
  return prisma.paymentCard.findMany({
    where: { workspaceId: ctx.workspaceId, status: 'ACTIVE' },
    select: { id: true, nickname: true, last4: true, brand: true },
    orderBy: { nickname: 'asc' },
  });
}

// ---------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------

export async function listPlatformsWithLinks(ctx: AuthContext) {
  const platforms = await prisma.platform.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { name: 'asc' },
    include: {
      owner: { select: { id: true, name: true } },
      cardLinks: {
        include: { card: { select: { id: true, nickname: true, last4: true, brand: true } } },
      },
      subscriptions: {
        select: {
          id: true,
          planName: true,
          amount: true,
          currency: true,
          cadence: true,
          intervalDays: true,
          nextChargeAt: true,
          status: true,
        },
      },
    },
  });

  return platforms.map((platform) => ({
    id: platform.id,
    name: platform.name,
    category: platform.category,
    websiteUrl: platform.websiteUrl,
    cancellationUrl: platform.cancellationUrl,
    accountIdentifier: platform.accountIdentifier,
    notes: platform.notes,
    owner: platform.owner,
    cards: platform.cardLinks.map((link) => ({
      linkId: link.id,
      cardId: link.card.id,
      nickname: link.card.nickname,
      last4: link.card.last4,
      brand: link.card.brand,
      status: link.status,
      linkedAt: link.linkedAt,
      removedAt: link.removedAt,
      lastVerifiedAt: link.lastVerifiedAt,
    })),
    subscriptions: platform.subscriptions.map((s) => ({
      id: s.id,
      planName: s.planName,
      amount: s.amount.toString(),
      currency: s.currency,
      status: s.status,
      nextChargeAt: s.nextChargeAt,
      monthlyEquivalent: monthlyEquivalent({
        amount: s.amount.toString(),
        currency: s.currency,
        cadence: s.cadence,
        intervalDays: s.intervalDays,
        nextChargeAt: s.nextChargeAt,
      }),
    })),
  }));
}

export async function listPlatformOptions(ctx: AuthContext) {
  return prisma.platform.findMany({
    where: { workspaceId: ctx.workspaceId },
    select: { id: true, name: true, category: true },
    orderBy: { name: 'asc' },
  });
}

/** Distinct subscription categories in use, for filters. */
export async function listSubscriptionCategories(ctx: AuthContext): Promise<string[]> {
  const rows = await prisma.subscription.findMany({
    where: { workspaceId: ctx.workspaceId },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });
  return rows.map((r) => r.category);
}

// ---------------------------------------------------------------------------
// Expenses (actual spend)
// ---------------------------------------------------------------------------

export async function listExpenses(
  ctx: AuthContext,
  options: {
    from?: Date;
    to?: Date;
    category?: string;
    subscriptionId?: string;
    pagination: Pagination;
  },
) {
  const where: Prisma.ExpenseWhereInput = {
    workspaceId: ctx.workspaceId,
    ...(options.from || options.to
      ? {
          paidAt: {
            ...(options.from ? { gte: options.from } : {}),
            ...(options.to ? { lte: options.to } : {}),
          },
        }
      : {}),
    ...(options.category ? { category: options.category } : {}),
    ...(options.subscriptionId ? { subscriptionId: options.subscriptionId } : {}),
  };

  const [rows, total, grouped] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { paidAt: 'desc' },
      ...skipTake(options.pagination),
      include: {
        subscription: { select: { id: true, planName: true, platform: { select: { name: true } } } },
        project: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        createdBy: { select: { name: true } },
      },
    }),
    prisma.expense.count({ where }),
    prisma.expense.groupBy({ by: ['currency'], where, _sum: { amount: true } }),
  ]);

  return {
    rows,
    total,
    page: options.pagination.page,
    pageSize: options.pagination.pageSize,
    totalsByCurrency: Object.fromEntries(
      grouped.map((g) => [g.currency, (g._sum.amount ?? 0).toString()]),
    ),
  };
}
