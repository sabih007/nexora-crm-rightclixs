/**
 * Development seed.
 *
 * Creates a demonstrably fake office: every client, platform and person is
 * prefixed "[DEMO]" or uses an example.com address, so seeded data can never
 * be mistaken for real records. Refuses to run with NODE_ENV=production.
 *
 *   npm run db:seed
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const DEMO_PASSWORD = 'NexoraDemo!2026';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed demo data in production.');
    process.exit(1);
  }

  const { prisma } = await import('../src/lib/db');
  const { hashPassword } = await import('../src/lib/auth/crypto');
  const { ensureWorkspace, DEFAULT_SETTINGS } = await import('../src/lib/workspace');
  const { normalizeName } = await import('../src/lib/utils');
  const { computeInvoiceTotals } = await import('../src/features/invoices/calculations');
  const { addDays, addMonths, todayUtc } = await import('../src/lib/dates');

  const workspaceId = await ensureWorkspace();
  const today = todayUtc();

  console.log('\n  Seeding demo data…\n');

  // ---------------------------------------------------------------------
  // Team
  // ---------------------------------------------------------------------
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const people = [
    { email: 'owner@example.com', name: '[DEMO] Ayesha Khan', role: 'OWNER' as const },
    { email: 'admin@example.com', name: '[DEMO] Bilal Ahmed', role: 'ADMIN' as const },
    { email: 'finance@example.com', name: '[DEMO] Fatima Noor', role: 'FINANCE' as const },
    { email: 'manager@example.com', name: '[DEMO] Hassan Raza', role: 'MANAGER' as const },
    { email: 'staff@example.com', name: '[DEMO] Zara Iqbal', role: 'STAFF' as const },
  ];

  const users: Record<string, string> = {};
  for (const person of people) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      // Demo accounts are reset to the demo password every time the seed
      // runs, so the credentials printed below are always the ones that
      // work. This is a development-only script and refuses to run with
      // NODE_ENV=production.
      update: { name: person.name, passwordHash, status: 'ACTIVE' },
      create: {
        email: person.email,
        name: person.name,
        passwordHash,
        status: 'ACTIVE',
        timezone: 'Asia/Karachi',
      },
      select: { id: true },
    });
    users[person.role] = user.id;

    await prisma.membership.upsert({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
      update: { role: person.role },
      create: { workspaceId, userId: user.id, role: person.role },
    });
  }
  console.log(`  ✓ ${people.length} team members`);

  await prisma.setting.upsert({
    where: { workspaceId_key: { workspaceId, key: 'workspace' } },
    update: {},
    create: { workspaceId, key: 'workspace', valueJson: { ...DEFAULT_SETTINGS } },
  });

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      addressLine1: '12 Demo Plaza, Gulberg III',
      city: 'Lahore',
      postalCode: '54660',
      country: 'Pakistan',
      email: 'accounts@example.com',
      phone: '+92 42 0000 0000',
      taxId: 'NTN-0000000-0',
    },
  });

  // ---------------------------------------------------------------------
  // Exchange rates (clearly marked as manual demo rates)
  // ---------------------------------------------------------------------
  const rates: [string, string, string][] = [
    ['USD', 'PKR', '278.50'],
    ['EUR', 'PKR', '302.10'],
    ['GBP', 'PKR', '353.75'],
    ['AED', 'PKR', '75.80'],
  ];
  for (const [base, quote, rate] of rates) {
    await prisma.exchangeRate.upsert({
      where: {
        baseCurrency_quoteCurrency_effectiveDate: {
          baseCurrency: base,
          quoteCurrency: quote,
          effectiveDate: today,
        },
      },
      update: { rate, source: 'demo-seed' },
      create: {
        baseCurrency: base,
        quoteCurrency: quote,
        rate,
        effectiveDate: today,
        source: 'demo-seed',
      },
    });
  }
  console.log(`  ✓ ${rates.length} demo exchange rates (source: demo-seed)`);

  // ---------------------------------------------------------------------
  // Clients
  // ---------------------------------------------------------------------
  const clientSeeds = [
    {
      name: '[DEMO] Harbour Logistics Ltd',
      type: 'COMPANY' as const,
      email: 'accounts@harbour.example.com',
      phone: '+92 21 1111 1111',
      currency: 'PKR',
      status: 'ACTIVE' as const,
      tags: ['logistics', 'retainer'],
      city: 'Karachi',
    },
    {
      name: '[DEMO] Northwind Studio',
      type: 'COMPANY' as const,
      email: 'hello@northwind.example.com',
      phone: '+44 20 2222 2222',
      currency: 'GBP',
      status: 'ACTIVE' as const,
      tags: ['design', 'uk'],
      city: 'London',
    },
    {
      name: '[DEMO] Cedar & Co',
      type: 'COMPANY' as const,
      email: 'finance@cedar.example.com',
      currency: 'USD',
      status: 'ACTIVE' as const,
      tags: ['saas'],
      city: 'Austin',
    },
    {
      name: '[DEMO] Imran Sheikh',
      type: 'INDIVIDUAL' as const,
      email: 'imran@example.com',
      currency: 'PKR',
      status: 'PROSPECT' as const,
      tags: ['consulting'],
      city: 'Islamabad',
    },
    {
      name: '[DEMO] Meridian Health',
      type: 'COMPANY' as const,
      email: 'ap@meridian.example.com',
      currency: 'EUR',
      status: 'INACTIVE' as const,
      tags: ['healthcare'],
      city: 'Amsterdam',
    },
  ];

  const clientIds: string[] = [];
  for (const seed of clientSeeds) {
    const existing = await prisma.client.findFirst({
      where: { workspaceId, name: seed.name },
      select: { id: true },
    });
    if (existing) {
      clientIds.push(existing.id);
      continue;
    }
    const client = await prisma.client.create({
      data: {
        workspaceId,
        name: seed.name,
        normalizedName: normalizeName(seed.name),
        type: seed.type,
        email: seed.email,
        phone: seed.phone ?? null,
        billingCurrency: seed.currency,
        status: seed.status,
        tags: seed.tags,
        addressJson: { line1: '1 Example Street', city: seed.city, country: 'Demo' },
        notes: 'Seeded demonstration record. Not a real client.',
        contacts: {
          create: [
            {
              name: '[DEMO] Primary Contact',
              email: seed.email,
              position: 'Accounts',
              isPrimary: true,
            },
          ],
        },
      },
      select: { id: true },
    });
    clientIds.push(client.id);
  }
  console.log(`  ✓ ${clientIds.length} clients`);

  // ---------------------------------------------------------------------
  // Projects and tasks
  // ---------------------------------------------------------------------
  const projectSeeds = [
    {
      name: '[DEMO] Warehouse portal rebuild',
      clientIndex: 0,
      currency: 'PKR',
      budget: '1850000',
      status: 'ACTIVE' as const,
      priority: 'HIGH' as const,
      due: addDays(today, 24),
    },
    {
      name: '[DEMO] Brand system refresh',
      clientIndex: 1,
      currency: 'GBP',
      budget: '18500',
      status: 'ACTIVE' as const,
      priority: 'MEDIUM' as const,
      due: addDays(today, 51),
    },
    {
      name: '[DEMO] Billing integration',
      clientIndex: 2,
      currency: 'USD',
      budget: '42000',
      status: 'PLANNING' as const,
      priority: 'URGENT' as const,
      due: addDays(today, 12),
    },
    {
      name: '[DEMO] Internal tooling',
      clientIndex: null,
      currency: 'PKR',
      budget: '300000',
      status: 'ON_HOLD' as const,
      priority: 'LOW' as const,
      due: null,
    },
  ];

  const taskTitles = [
    ['Requirements workshop', 'DONE'],
    ['Information architecture', 'DONE'],
    ['Component library', 'IN_PROGRESS'],
    ['Inventory sync service', 'IN_PROGRESS'],
    ['Access control review', 'IN_REVIEW'],
    ['Load testing', 'TODO'],
    ['Client sign-off', 'TODO'],
    ['Legacy data migration', 'BLOCKED'],
  ] as const;

  const projectIds: string[] = [];
  for (const seed of projectSeeds) {
    const existing = await prisma.project.findFirst({
      where: { workspaceId, name: seed.name },
      select: { id: true },
    });
    if (existing) {
      projectIds.push(existing.id);
      continue;
    }

    const project = await prisma.project.create({
      data: {
        workspaceId,
        clientId: seed.clientIndex === null ? null : (clientIds[seed.clientIndex] ?? null),
        name: seed.name,
        description: 'Seeded demonstration project.',
        ownerId: users.MANAGER ?? null,
        status: seed.status,
        priority: seed.priority,
        budgetAmount: seed.budget,
        currency: seed.currency,
        startDate: addDays(today, -40),
        dueDate: seed.due,
        tags: ['demo'],
        members: {
          create: [
            { userId: users.MANAGER as string },
            { userId: users.STAFF as string },
          ],
        },
      },
      select: { id: true },
    });
    projectIds.push(project.id);

    await prisma.task.createMany({
      data: taskTitles.map(([title, status], index) => ({
        projectId: project.id,
        title: `[DEMO] ${title}`,
        status: status as never,
        priority: (['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const)[index % 4] as never,
        assigneeId: index % 2 === 0 ? (users.STAFF as string) : (users.MANAGER as string),
        dueDate: addDays(today, index * 4 - 6),
        position: (index + 1) * 1000,
        completedAt: status === 'DONE' ? addDays(today, -5) : null,
      })),
    });
  }
  console.log(`  ✓ ${projectIds.length} projects with tasks`);

  // ---------------------------------------------------------------------
  // Invoices and payments
  // ---------------------------------------------------------------------
  const invoiceSeeds = [
    { clientIndex: 0, currency: 'PKR', status: 'PAID' as const, issueOffset: -58, amount: '650000', paid: '650000' },
    { clientIndex: 0, currency: 'PKR', status: 'PARTIALLY_PAID' as const, issueOffset: -24, amount: '480000', paid: '200000' },
    { clientIndex: 1, currency: 'GBP', status: 'SENT' as const, issueOffset: -9, amount: '7400', paid: '0' },
    { clientIndex: 2, currency: 'USD', status: 'OVERDUE' as const, issueOffset: -47, amount: '12500', paid: '0' },
    { clientIndex: 1, currency: 'GBP', status: 'DRAFT' as const, issueOffset: -2, amount: '3200', paid: '0' },
  ];

  let sequence = 1;
  let invoicesCreated = 0;

  for (const seed of invoiceSeeds) {
    const clientId = clientIds[seed.clientIndex];
    if (!clientId) continue;

    const invoiceNumber = `INV-${today.getUTCFullYear()}-${String(sequence).padStart(4, '0')}`;
    sequence += 1;

    const existing = await prisma.invoice.findFirst({
      where: { workspaceId, invoiceNumber },
      select: { id: true },
    });
    if (existing) continue;

    const issueDate = addDays(today, seed.issueOffset);
    const dueDate = addDays(issueDate, 14);

    const lines = [
      {
        description: '[DEMO] Design and development services',
        quantity: '1',
        unitPrice: seed.amount,
        discountAmount: '0',
        taxRate: '0',
      },
    ];

    const totals = computeInvoiceTotals({
      lines,
      currency: seed.currency,
      taxMode: 'PER_LINE',
      invoiceTaxRate: '0',
    });

    const client = await prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { name: true, email: true, addressJson: true, taxId: true },
    });

    const isIssued = seed.status !== 'DRAFT';

    const invoice = await prisma.invoice.create({
      data: {
        workspaceId,
        clientId,
        projectId: projectIds[seed.clientIndex] ?? null,
        invoiceNumber,
        status: seed.status,
        currency: seed.currency,
        issueDate,
        dueDate,
        taxMode: 'PER_LINE',
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
        amountPaid: seed.paid,
        clientSnapshotJson: isIssued ? (client as object) : undefined,
        issuedAt: isIssued ? issueDate : null,
        sentAt: isIssued ? issueDate : null,
        paidAt: seed.status === 'PAID' ? addDays(issueDate, 9) : null,
        terms: 'Payment due within 14 days.',
        lines: {
          create: totals.lines.map((line, index) => ({
            description: lines[index]?.description ?? 'Services',
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountAmount: line.discountAmount,
            taxRate: line.taxRate,
            lineSubtotal: line.lineSubtotal,
            lineTax: line.lineTax,
            lineTotal: line.lineTotal,
            position: index,
          })),
        },
      },
      select: { id: true },
    });
    invoicesCreated += 1;

    if (seed.paid !== '0') {
      const payment = await prisma.payment.create({
        data: {
          workspaceId,
          clientId,
          invoiceId: invoice.id,
          amount: seed.paid,
          currency: seed.currency,
          paymentDate: addDays(issueDate, 9),
          method: 'BANK_TRANSFER',
          reference: `[DEMO] TRX-${sequence}`,
          createdById: users.FINANCE as string,
        },
        select: { id: true },
      });
      await prisma.paymentAllocation.create({
        data: { paymentId: payment.id, invoiceId: invoice.id, allocatedAmount: seed.paid },
      });
    }
  }
  // The seed writes invoice numbers directly, so move the workspace counter
  // past them; otherwise the first invoice created through the UI would
  // collide with a seeded number.
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { invoiceNextNo: sequence },
  });

  console.log(`  ✓ ${invoicesCreated} invoices with payments`);

  // ---------------------------------------------------------------------
  // Cards, platforms, subscriptions
  // ---------------------------------------------------------------------
  const cardSeeds = [
    { nickname: '[DEMO] Office Visa', issuer: 'Demo Bank', brand: 'VISA' as const, last4: '4242' },
    { nickname: '[DEMO] Marketing Mastercard', issuer: 'Demo Bank', brand: 'MASTERCARD' as const, last4: '5588' },
    { nickname: '[DEMO] Director Amex', issuer: 'Demo Charge', brand: 'AMEX' as const, last4: '9001' },
  ];

  const cardIds: string[] = [];
  for (const seed of cardSeeds) {
    const existing = await prisma.paymentCard.findFirst({
      where: { workspaceId, nickname: seed.nickname },
      select: { id: true },
    });
    if (existing) {
      cardIds.push(existing.id);
      continue;
    }
    const card = await prisma.paymentCard.create({
      data: {
        workspaceId,
        nickname: seed.nickname,
        issuer: seed.issuer,
        brand: seed.brand,
        last4: seed.last4,
        expiryMonth: 9,
        expiryYear: today.getUTCFullYear() + 2,
        ownerId: users.FINANCE as string,
        status: 'ACTIVE',
        notes: 'Seeded record. Only the last four digits are ever stored.',
      },
      select: { id: true },
    });
    cardIds.push(card.id);
  }

  const platformSeeds = [
    { name: '[DEMO] Cloudhost', category: 'Hosting', url: 'https://hosting.example.com' },
    { name: '[DEMO] DesignSuite', category: 'Design', url: 'https://design.example.com' },
    { name: '[DEMO] MailRelay', category: 'Email', url: 'https://mail.example.com' },
    { name: '[DEMO] CodeVault', category: 'Developer tools', url: 'https://code.example.com' },
    { name: '[DEMO] AdCentre', category: 'Marketing', url: 'https://ads.example.com' },
  ];

  const platformIds: string[] = [];
  for (const seed of platformSeeds) {
    const platform = await prisma.platform.upsert({
      where: { workspaceId_name: { workspaceId, name: seed.name } },
      update: {},
      create: {
        workspaceId,
        name: seed.name,
        category: seed.category,
        websiteUrl: seed.url,
        accountIdentifier: 'billing@example.com',
        cancellationUrl: `${seed.url}/billing`,
        ownerId: users.ADMIN as string,
      },
      select: { id: true },
    });
    platformIds.push(platform.id);
  }

  const linkSeeds = [
    [0, 0, 'ACTIVE'],
    [1, 0, 'ACTIVE'],
    [2, 1, 'ACTIVE'],
    [3, 0, 'ACTIVE'],
    [4, 1, 'REMOVED'],
    [4, 2, 'ACTIVE'],
  ] as const;

  for (const [platformIndex, cardIndex, status] of linkSeeds) {
    const platformId = platformIds[platformIndex];
    const cardId = cardIds[cardIndex];
    if (!platformId || !cardId) continue;
    await prisma.platformCardLink.upsert({
      where: { workspaceId_platformId_cardId: { workspaceId, platformId, cardId } },
      update: {},
      create: {
        workspaceId,
        platformId,
        cardId,
        status: status as never,
        linkedAt: addDays(today, -200),
        removedAt: status === 'REMOVED' ? addDays(today, -30) : null,
        lastVerifiedAt: addDays(today, -14),
        responsibleId: users.ADMIN as string,
      },
    });
  }

  const subscriptionSeeds = [
    { platformIndex: 0, cardIndex: 0, plan: 'Business', amount: '249.00', currency: 'USD', cadence: 'MONTHLY' as const, nextIn: 6, category: 'Hosting' },
    { platformIndex: 1, cardIndex: 0, plan: 'Teams annual', amount: '1199.88', currency: 'USD', cadence: 'ANNUAL' as const, nextIn: 48, category: 'Design' },
    { platformIndex: 2, cardIndex: 1, plan: 'Growth', amount: '89.00', currency: 'EUR', cadence: 'MONTHLY' as const, nextIn: 19, category: 'Email' },
    { platformIndex: 3, cardIndex: 0, plan: 'Org quarterly', amount: '540.00', currency: 'USD', cadence: 'QUARTERLY' as const, nextIn: 72, category: 'Developer tools' },
    { platformIndex: 4, cardIndex: 2, plan: 'Ads retainer', amount: '125000', currency: 'PKR', cadence: 'MONTHLY' as const, nextIn: 2, category: 'Marketing' },
  ];

  let subsCreated = 0;
  for (const seed of subscriptionSeeds) {
    const platformId = platformIds[seed.platformIndex];
    const cardId = cardIds[seed.cardIndex];
    if (!platformId) continue;

    const existing = await prisma.subscription.findFirst({
      where: { workspaceId, platformId, planName: seed.plan },
      select: { id: true },
    });
    if (existing) continue;

    const subscription = await prisma.subscription.create({
      data: {
        workspaceId,
        platformId,
        cardId: cardId ?? null,
        planName: seed.plan,
        amount: seed.amount,
        currency: seed.currency,
        cadence: seed.cadence,
        nextChargeAt: addDays(today, seed.nextIn),
        startedAt: addMonths(today, -14),
        autoRenew: true,
        status: 'ACTIVE',
        category: seed.category,
        noticeDays: seed.cadence === 'ANNUAL' ? 30 : null,
      },
      select: { id: true },
    });
    subsCreated += 1;

    // Two historic paid charges per subscription — real expenses, distinct
    // from the forecast.
    for (const monthsAgo of [1, 2]) {
      await prisma.expense.create({
        data: {
          workspaceId,
          subscriptionId: subscription.id,
          amount: seed.amount,
          currency: seed.currency,
          paidAt: addMonths(today, -monthsAgo),
          category: seed.category,
          description: `[DEMO] ${seed.plan} charge`,
          createdById: users.FINANCE as string,
        },
      });
    }
  }
  console.log(`  ✓ ${cardIds.length} cards, ${platformIds.length} platforms, ${subsCreated} subscriptions`);

  // Default reminder rules
  for (const daysBefore of DEFAULT_SETTINGS.renewalReminderDays) {
    await prisma.reminderRule.upsert({
      where: {
        workspaceId_entityType_daysBefore_channel: {
          workspaceId,
          entityType: 'subscription',
          daysBefore,
          channel: 'IN_APP',
        },
      },
      update: {},
      create: { workspaceId, entityType: 'subscription', daysBefore, channel: 'IN_APP' },
    });
  }

  console.log('\n  ──────────────────────────────────────────────────────────');
  console.log('   Demo data ready. Sign in with any of:');
  for (const person of people) {
    console.log(`     ${person.role.padEnd(8)} ${person.email}`);
  }
  console.log(`\n   Password for all demo accounts: ${DEMO_PASSWORD}`);
  console.log('\n   Every seeded record is prefixed [DEMO] or uses example.com.');
  console.log('   Do not run this against a production database.');
  console.log('  ──────────────────────────────────────────────────────────\n');

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
