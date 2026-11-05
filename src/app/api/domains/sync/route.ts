import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const BASE = 'https://spaceship.dev/api/v1';

// Fallback only — used if the pricing API returns nothing for a TLD (e.g. site: 15.28)
const FALLBACK_PRICES: Record<string, number> = {};

function headers() {
  return {
    'X-API-Key': process.env.SPACESHIP_API_KEY!,
    'X-API-Secret': process.env.SPACESHIP_API_SECRET!,
  };
}

async function getJson(url: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: headers(), cache: 'no-store' });
    if (res.status === 429) { await new Promise(r => setTimeout(r, 5000)); continue; }
    if (!res.ok) throw new Error(`Spaceship ${res.status} on ${url}: ${await res.text()}`);
    return res.json();
  }
  throw new Error(`Spaceship rate limit on ${url}`);
}

// Finds the 1-year renewal price in Spaceship's pricing response
function extractRenewal(json: any): { amount: number; currency: string } | null {
  const renew: any[] = json?.prices?.renew ?? [];
  if (!renew.length) return null;

  const oneYear =
    renew.find(r => r?.period?.value === 1 && r?.period?.unit === 'y') ?? renew[0];

  const p =
    oneYear?.priceInDefaultCurrency?.finalPrice ??
    oneYear?.priceInDefaultCurrency?.regularPrice ??
    oneYear?.finalPrice ??
    oneYear?.regularPrice;

  const amount = parseFloat(p?.amount);
  if (!amount) return null;
  return { amount, currency: p?.currency ?? 'USD' };
}

// Cache per TLD so 100 .com domains = 1 API call
const tldCache = new Map<string, { amount: number; currency: string } | null>();

async function renewalPrice(domain: string) {
  const tld = domain.split('.').slice(1).join('.');
  if (!tldCache.has(tld)) {
    try {
      tldCache.set(tld, extractRenewal(await getJson(`${BASE}/tlds/${tld}/pricing`)));
    } catch {
      tldCache.set(tld, null);
    }
  }
  const cached = tldCache.get(tld);
  if (cached) return cached;
  const fb = FALLBACK_PRICES[tld];
  return fb ? { amount: fb, currency: 'USD' } : null;
}

export async function POST(req: Request) {
  try {
    const workspace = await prisma.workspace.findFirst({ select: { id: true } });
    if (!workspace) return NextResponse.json({ error: 'No workspace' }, { status: 400 });
    const workspaceId = workspace.id;

    // ── 5-minute lock: skip if synced recently (manual button passes ?force=1) ──
    const force = new URL(req.url).searchParams.get('force') === '1';
    const lockKey = { workspaceId_key: { workspaceId, key: 'spaceship.lastSync' } };

    if (!force) {
      const last = await prisma.setting.findUnique({ where: lockKey });
      const lastAt = last ? new Date((last.valueJson as any)?.at) : null;
      if (lastAt && Date.now() - lastAt.getTime() < 4.5 * 60 * 1000) {
        return NextResponse.json({ skipped: true, lastSyncAt: lastAt });
      }
    }

    await prisma.setting.upsert({
      where:  lockKey,
      update: { valueJson: { at: new Date().toISOString() } },
      create: { workspaceId, key: 'spaceship.lastSync', valueJson: { at: new Date().toISOString() } },
    });

    tldCache.clear();

    // Spaceship platform (auto-created) + the card linked to it
    const platform = await prisma.platform.upsert({
      where:  { workspaceId_name: { workspaceId, name: 'Spaceship' } },
      update: {},
      create: { workspaceId, name: 'Spaceship', websiteUrl: 'https://www.spaceship.com', category: 'Domains' },
      include: { cardLinks: { where: { status: 'ACTIVE' }, take: 1 } },
    });
    const cardId = platform.cardLinks[0]?.cardId ?? null;

    let synced = 0, subsCreated = 0, priced = 0;
    const unpriced: string[] = [];

    async function syncOne(d: any) {
      const data = {
        registrationDate: d.registrationDate ? new Date(d.registrationDate) : null,
        expirationDate:   d.expirationDate ? new Date(d.expirationDate) : null,
        autoRenew:        !!d.autoRenew,
        status:           d.eppStatuses ?? [],
        lastSyncedAt:     new Date(),
      };

      // Save the domain
      const domain = await prisma.domain.upsert({
        where:  { workspaceId_name: { workspaceId, name: d.name } },
        update: data,
        create: { workspaceId, name: d.name, ...data },
      });

      if (!domain.expirationDate) return;

      const price = await renewalPrice(domain.name);
      if (price) priced++; else unpriced.push(domain.name);

      const subStatus = domain.expirationDate < new Date() ? 'EXPIRED' : 'ACTIVE';

      // Create or update its subscription
      if (domain.subscriptionId) {
        await prisma.subscription.update({
          where: { id: domain.subscriptionId },
          data: {
            nextChargeAt: domain.expirationDate,
            autoRenew:    domain.autoRenew,
            status:       subStatus,
            ...(price ? { amount: price.amount.toFixed(2), currency: price.currency } : {}),
            ...(domain.clientId ? { clientId: domain.clientId } : {}),
          },
        });
        if (cardId) {
          await prisma.subscription.updateMany({
            where: { id: domain.subscriptionId, cardId: null },
            data:  { cardId },
          });
        }
      } else {
        const sub = await prisma.subscription.create({
          data: {
            workspaceId,
            platformId:   platform.id,
            cardId,
            clientId:     domain.clientId,
            planName:     `Domain renewal — ${domain.name}`,
            amount:       (price?.amount ?? 0).toFixed(2),
            currency:     price?.currency ?? 'USD',
            cadence:      'ANNUAL',
            nextChargeAt: domain.expirationDate,
            startedAt:    domain.registrationDate ?? new Date(),
            autoRenew:    domain.autoRenew,
            status:       subStatus,
            category:     'Domains',
          },
        });
        await prisma.domain.update({ where: { id: domain.id }, data: { subscriptionId: sub.id } });
        subsCreated++;
      }
    }

    const take = 100;
    let skip = 0, total = Infinity;

    while (skip < total) {
      const { items, total: t } = await getJson(
        `${BASE}/domains?take=${take}&skip=${skip}&orderBy=expirationDate`
      );
      total = t;

      // save in batches of 10 (avoids the 5s transaction timeout)
      for (let i = 0; i < items.length; i += 10) {
        await Promise.all(items.slice(i, i + 10).map(syncOne));
      }

      synced += items.length;
      skip += take;
    }

    return NextResponse.json({ synced, subsCreated, priced, unpriced, cardLinked: !!cardId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}