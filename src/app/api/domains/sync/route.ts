import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const BASE = 'https://spaceship.dev/api/v1';

// Yearly renewal prices in USD — fill these from Spaceship's pricing page.
// Unknown TLDs get 0; you can edit any amount in Nexora and the sync won't overwrite it.
const RENEWAL_PRICES: Record<string, number> = {
  com: 0,
  net: 0,
  org: 0,
  co: 0,
  io: 0,
  pk: 0,
};

function priceFor(domain: string) {
  const tld = domain.split('.').slice(1).join('.'); // handles "com.pk" too
  return RENEWAL_PRICES[tld] ?? RENEWAL_PRICES[tld.split('.').pop()!] ?? 0;
}

export async function POST() {
  try {
    const workspace = await prisma.workspace.findFirst({ select: { id: true } });
    if (!workspace) return NextResponse.json({ error: 'No workspace' }, { status: 400 });
    const workspaceId = workspace.id;

    // 1. Spaceship platform (auto-created) + the card linked to it
    const platform = await prisma.platform.upsert({
      where: { workspaceId_name: { workspaceId, name: 'Spaceship' } },
      update: {},
      create: { workspaceId, name: 'Spaceship', websiteUrl: 'https://www.spaceship.com', category: 'Domains' },
      include: { cardLinks: { where: { status: 'ACTIVE' }, take: 1 } },
    });
    const cardId = platform.cardLinks[0]?.cardId ?? null;

    const headers = {
      'X-API-Key': process.env.SPACESHIP_API_KEY!,
      'X-API-Secret': process.env.SPACESHIP_API_SECRET!,
    };

    const take = 100;
    let skip = 0;
    let total = Infinity;
    let synced = 0;
    let subsCreated = 0;

    async function syncOne(d: any) {
      const data = {
        registrationDate: d.registrationDate ? new Date(d.registrationDate) : null,
        expirationDate: d.expirationDate ? new Date(d.expirationDate) : null,
        autoRenew: !!d.autoRenew,
        status: d.eppStatuses ?? [],
        lastSyncedAt: new Date(),
      };

      // 2. Save the domain
      const domain = await prisma.domain.upsert({
        where: { workspaceId_name: { workspaceId, name: d.name } },
        update: data,
        create: { workspaceId, name: d.name, ...data },
      });

      if (!domain.expirationDate) return;

      const subStatus = domain.expirationDate < new Date() ? 'EXPIRED' : 'ACTIVE';

      // 3. Create or update its subscription
      if (domain.subscriptionId) {
        const price = priceFor(domain.name);
        if (price > 0) {
          await prisma.subscription.updateMany({
            where: { id: domain.subscriptionId, amount: 0 },
            data: { amount: price.toFixed(2) },
          });
        }
        await prisma.subscription.update({
          where: { id: domain.subscriptionId },
          data: {
            nextChargeAt: domain.expirationDate,
            autoRenew: domain.autoRenew,
            status: subStatus,
            ...(domain.clientId ? { clientId: domain.clientId } : {}),
          },
        });
        // attach the card only if the subscription has none yet
        if (cardId) {
          await prisma.subscription.updateMany({
            where: { id: domain.subscriptionId, cardId: null },
            data: { cardId },
          });
        }
      } else {
        const sub = await prisma.subscription.create({
          data: {
            workspaceId,
            platformId: platform.id,
            cardId,
            clientId: domain.clientId,
            planName: `Domain renewal — ${domain.name}`,
            amount: priceFor(domain.name).toFixed(2),
            currency: 'USD',
            cadence: 'ANNUAL',
            nextChargeAt: domain.expirationDate,
            startedAt: domain.registrationDate ?? new Date(),
            autoRenew: domain.autoRenew,
            status: subStatus,
            category: 'Domains',
          },
        });
        await prisma.domain.update({ where: { id: domain.id }, data: { subscriptionId: sub.id } });
        subsCreated++;
      }
    }

    while (skip < total) {
      const res = await fetch(
        `${BASE}/domains?take=${take}&skip=${skip}&orderBy=expirationDate`,
        { headers, cache: 'no-store' }
      );

      if (res.status === 429) { await new Promise(r => setTimeout(r, 5000)); continue; }
      if (!res.ok) throw new Error(`Spaceship ${res.status}: ${await res.text()}`);

      const { items, total: t } = await res.json();
      total = t;

      for (let i = 0; i < items.length; i += 10) {
        await Promise.all(items.slice(i, i + 10).map(syncOne));
      }

      synced += items.length;
      skip += take;
    }

    return NextResponse.json({ synced, subsCreated, cardLinked: !!cardId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}