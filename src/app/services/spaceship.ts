// src/services/spaceship.ts
import { Domain } from '../(app)/models/Domain';

const BASE = 'https://spaceship.dev/api/v1';

export async function syncSpaceshipDomains() {
  const headers = {
    'X-API-Key': process.env.SPACESHIP_API_KEY!,
    'X-API-Secret': process.env.SPACESHIP_API_SECRET!,
  };

  const take = 100;
  let skip = 0;
  let total = Infinity;
  let synced = 0;

  while (skip < total) {
    const res = await fetch(`${BASE}/domains?take=${take}&skip=${skip}&orderBy=expirationDate`, { headers });

    if (res.status === 429) {               // rate limited → wait 5s and retry
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    if (!res.ok) throw new Error(`Spaceship ${res.status}: ${await res.text()}`);

    const { items, total: t } = await res.json();
    total = t;

    if (items.length) {
      await Domain.bulkWrite(items.map((d: any) => ({
        updateOne: {
          filter: { name: d.name },
          update: { $set: {
            registrationDate: d.registrationDate,
            expirationDate:   d.expirationDate,
            autoRenew:        d.autoRenew,
            status:           d.eppStatuses ?? [],
            lastSyncedAt:     new Date(),
          }},
          upsert: true,
        },
      })));
      synced += items.length;
    }

    skip += take;
  }

  return { synced };
}