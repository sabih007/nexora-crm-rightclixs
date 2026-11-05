import { prisma } from '@/lib/db';
import { SyncButton } from './sync-button';

export const dynamic = 'force-dynamic';

function daysLeft(d: Date | null) {
  if (!d) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

export default async function DomainsPage() {
  const domains = await prisma.domain.findMany({
    orderBy: { expirationDate: 'asc' },
    include: { client: { select: { name: true } } },
  });

  const soon = domains.filter(d => { const n = daysLeft(d.expirationDate); return n !== null && n <= 30; });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Domains</h1>
          <p className="text-sm opacity-70">
            {domains.length} domains · {soon.length} expiring in 30 days
          </p>
        </div>
        <SyncButton />
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead className="text-left opacity-70">
            <tr>
              <th className="p-3">Domain</th>
              <th className="p-3">Client</th>
              <th className="p-3">Expires / Renews</th>
              <th className="p-3">Days left</th>
              <th className="p-3">Auto-renew</th>
            </tr>
          </thead>
          <tbody>
            {domains.map(d => {
              const n = daysLeft(d.expirationDate);
              const danger = n !== null && n <= 30 && !d.autoRenew;
              return (
                <tr key={d.id} className="border-t border-white/10">
                  <td className="p-3 font-medium">{d.name}</td>
                  <td className="p-3">{d.client?.name ?? '—'}</td>
                  <td className="p-3">{d.expirationDate?.toLocaleDateString('en-GB') ?? '—'}</td>
                  <td className={`p-3 ${danger ? 'text-red-400 font-semibold' : n !== null && n <= 30 ? 'text-amber-400' : ''}`}>
                    {n ?? '—'}
                  </td>
                  <td className="p-3">{d.autoRenew ? 'On' : 'Off'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}