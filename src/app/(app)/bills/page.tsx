import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function BillsPage() {
  const expenses = await prisma.expense.findMany({
    orderBy: { paidAt: 'desc' },
    include: {
      subscription: { select: { nextChargeAt: true, autoRenew: true } },
      client: { select: { name: true } },
    },
  });

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Bills</h1>
        <p className="text-sm opacity-70">
          What you paid to vendors · {expenses.length} bills · ${total.toFixed(2)} total
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead className="text-left opacity-70">
            <tr>
              <th className="p-3">Title</th>
              <th className="p-3">Category</th>
              <th className="p-3">Client</th>
              <th className="p-3">Paid on</th>
              <th className="p-3">Next renewal</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3">Order ID</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map(e => (
              <tr key={e.id} className="border-t border-white/10">
                <td className="p-3 font-medium">{e.description}</td>
                <td className="p-3">{e.category}</td>
                <td className="p-3">{e.client?.name ?? '—'}</td>
                <td className="p-3">{e.paidAt.toLocaleDateString('en-GB')}</td>
                <td className="p-3">
                  {e.subscription?.nextChargeAt?.toLocaleDateString('en-GB') ?? '—'}
                  {e.subscription && !e.subscription.autoRenew && (
                    <span className="ml-2 text-xs text-red-400">auto-renew off</span>
                  )}
                </td>
                <td className="p-3 text-right font-medium">
                  {e.currency} {Number(e.amount).toFixed(2)}
                </td>
                <td className="p-3 font-mono text-xs opacity-60">{e.reference ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}