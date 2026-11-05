import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { prisma } from '@/lib/db';


const DAYS = 30;

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const limit = new Date(now.getTime() + DAYS * 86_400_000);

  const domains = await prisma.domain.findMany({
    where: { expirationDate: { gte: now, lte: limit }, subscriptionId: { not: null } },
    include: { subscription: { include: { card: true } } },
    orderBy: { expirationDate: 'asc' },
  });

  // skip ones already alerted for this renewal date
  const due = [];
  for (const d of domains) {
    const chargeDate = d.expirationDate!.toISOString().slice(0, 10);
    const dedupeKey = `${d.subscriptionId}:${chargeDate}:${DAYS}:EMAIL`;
    const sent = await prisma.subscriptionReminder.findUnique({ where: { dedupeKey } });
    if (!sent) due.push({ d, chargeDate, dedupeKey });
  }

  if (!due.length) return NextResponse.json({ sent: 0 });

  const rows = due.map(({ d }) => {
    const left = Math.ceil((d.expirationDate!.getTime() - now.getTime()) / 86_400_000);
    const s = d.subscription!;
    const card: any = s.card;
    return `<tr>
      <td style="padding:6px 10px">${d.name}</td>
      <td style="padding:6px 10px">${d.expirationDate!.toLocaleDateString('en-GB')}</td>
      <td style="padding:6px 10px">${left} days</td>
      <td style="padding:6px 10px">${s.currency} ${s.amount}</td>
      <td style="padding:6px 10px">${card ? '•••• ' + (card.last4 ?? card.lastFour ?? '') : '—'}</td>
      <td style="padding:6px 10px">${d.autoRenew ? 'On' : '<b style="color:#d33">OFF</b>'}</td>
    </tr>`;
  }).join('');

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.ALERT_FROM!,
    to: process.env.ALERT_EMAIL!,
    subject: `${due.length} domain(s) expiring within ${DAYS} days`,
    html: `<h2>Domains expiring soon</h2>
      <table border="1" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
        <tr><th>Domain</th><th>Expires</th><th>Left</th><th>Renewal</th><th>Card</th><th>Auto-renew</th></tr>
        ${rows}
      </table>`,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await prisma.subscriptionReminder.createMany({
    data: due.map(({ d, chargeDate, dedupeKey }) => ({
      subscriptionId: d.subscriptionId!,
      daysBefore: DAYS,
      chargeDate: new Date(chargeDate),
      channel: 'EMAIL' as const,
      dedupeKey,
    })),
    skipDuplicates: true,
  });

  return NextResponse.json({ sent: due.length });
}