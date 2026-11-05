import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { prisma } from '@/lib/db';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MONEY_RE = /(?:US)?\$\s?(\d{1,3}(?:,\d{3})*\.\d{2})/g;
const RECEIPT_RE = /(receipt|order|invoice|payment (?:received|successful|confirmation)|thank you for your (?:order|purchase)|renew)/i;
const NOT_RECEIPT_RE = /(failed|declined|unsuccessful|refund|reminder|will expire|is expiring|expires soon|action required)/i;
const HOSTING_RE = /(hosting|spacemail|email plan|vpn|ssl)/i;

function plain(m: ParsedMail) {
  const html = typeof m.html === 'string'
    ? m.html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    : '';
  return `${m.text ?? ''} ${html}`.replace(/\s+/g, ' ');
}

// Order ID = a UUID that appears right after the word "order" or "transaction"
function findOrderId(t: string) {
  const m = t.match(new RegExp(`(?:order|transaction)[^0-9a-f]{0,40}(${UUID})`, 'i'));
  return m ? m[1].toLowerCase() : null;
}

// Amount = the "Total" line; otherwise only if the email has exactly one price
function findAmount(t: string) {
  const total = t.match(/total[^$\d]{0,25}(?:US)?\$\s?(\d{1,3}(?:,\d{3})*\.\d{2})/i);
  if (total) return parseFloat(total[1].replace(/,/g, ''));
  const all = [...new Set([...t.matchAll(MONEY_RE)].map(m => m[1]))];
  return all.length === 1 ? parseFloat(all[0].replace(/,/g, '')) : null;
}

// Direct Spaceship emails + Spaceship emails forwarded as attachments
async function spaceshipMails(m: ParsedMail) {
  const out: ParsedMail[] = [];
  if (/spaceship/i.test(m.from?.text ?? '')) out.push(m);
  for (const a of m.attachments ?? []) {
    if (a.contentType === 'message/rfc822') {
      const inner = await simpleParser(a.content);
      if (/spaceship/i.test(inner.from?.text ?? '')) out.push(inner);
    }
  }
  return out;
}

export async function importSpaceshipReceipts(workspaceId: string) {
  if (!process.env.INVOICE_IMAP_HOST) return { skipped: 'IMAP not configured' };

  const owner =
    (await prisma.membership.findFirst({ where: { workspaceId, role: 'OWNER' }, select: { userId: true } })) ??
    (await prisma.membership.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' }, select: { userId: true } }));
  if (!owner) throw new Error('No workspace member to record expenses under');

  const domains = await prisma.domain.findMany({
    where: { workspaceId },
    select: { name: true, subscriptionId: true, clientId: true },
  });

  // only look at mail since the last run (2-day overlap for safety)
  const stateKey = { workspaceId_key: { workspaceId, key: 'spaceship.receiptsSince' } };
  const state = await prisma.setting.findUnique({ where: stateKey });
  const since = state
    ? new Date(new Date((state.valueJson as any).since).getTime() - 2 * 86_400_000)
    : new Date(Date.now() - 60 * 86_400_000);
  const startedAt = new Date();

  const imported: string[] = [];
  const review: { subject: string; reason: string }[] = [];

  const client = new ImapFlow({
    host: process.env.INVOICE_IMAP_HOST,
    port: Number(process.env.INVOICE_IMAP_PORT ?? 993),
    secure: true,
    auth: { user: process.env.INVOICE_IMAP_USER!, pass: process.env.INVOICE_IMAP_PASS! },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock(process.env.INVOICE_IMAP_MAILBOX ?? 'INBOX');
  try {
    const uids = await client.search(
      { since, or: [{ from: 'spaceship' }, { from: 'mindwave.com.pk' }] },
      { uid: true }
    );

    for (const uid of uids || []) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) continue;

      for (const m of await spaceshipMails(await simpleParser(msg.source))) {
        const subject = m.subject ?? '(no subject)';
        const t = `${subject} ${plain(m)}`;

        // ignore reminders, failed payments, refunds, marketing
        if (!RECEIPT_RE.test(t) || NOT_RECEIPT_RE.test(subject)) continue;

        const orderId = findOrderId(t);
        const amount = findAmount(t);
        if (!orderId || amount === null) {
          review.push({ subject, reason: !orderId ? 'no order ID found' : 'amount unclear' });
          continue; // never guess
        }

        // same order ID already saved (CSV import or earlier run), so skip
        const exists = await prisma.expense.findFirst({
          where: { workspaceId, reference: orderId }, select: { id: true },
        });
        if (exists) continue;

        const lower = t.toLowerCase();
        const matched = domains.filter(d =>
          new RegExp(`(^|[^a-z0-9.-])${d.name.toLowerCase().replace(/\./g, '\\.')}([^a-z0-9-]|$)`).test(lower)
        );
        const one = matched.length === 1 ? matched[0] : null;

        const description = matched.length ? matched.map(d => d.name).join(' + ') : subject.slice(0, 200);
        const category = matched.length ? 'Domains' : HOSTING_RE.test(t) ? 'Hosting & Email' : 'Spaceship';

        await prisma.expense.create({
          data: {
            workspaceId,
            subscriptionId: one?.subscriptionId ?? null,
            clientId: one?.clientId ?? null,
            amount: amount.toFixed(2),
            currency: 'USD',
            paidAt: m.date ?? new Date(),
            category,
            description,
            reference: orderId,
            createdById: owner.userId,
          },
        });
        imported.push(`${description} $${amount.toFixed(2)}`);
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }

  await prisma.setting.upsert({
    where: stateKey,
    update: { valueJson: { since: startedAt.toISOString() } },
    create: { workspaceId, key: 'spaceship.receiptsSince', valueJson: { since: startedAt.toISOString() } },
  });

  return { imported, review };
}