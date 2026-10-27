import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { resetTestData, setupTestDatabase, teardownTestDatabase } from '../helpers/db';
import {
  expectOk,
  makeContext,
  mockActionEnvironment,
  setActionContext,
} from '../helpers/action-context';

mockActionEnvironment();

/**
 * Spreadsheet import, end to end through the real actions:
 * preview → validate → commit, including the guarantee that nothing is
 * written before the final confirmation.
 */

let prisma: PrismaClient;
let importActions: typeof import('@/features/clients/import');
let storage: typeof import('@/lib/storage');

const CSV = [
  'Name,Email,Type,Billing Currency,City,Tags',
  'Northwind Trading,ap@northwind.example.com,COMPANY,GBP,London,retail;uk',
  'Imran Sheikh,imran@example.com,INDIVIDUAL,PKR,Lahore,consulting',
  ',missing@example.com,COMPANY,USD,Austin,',
  'Bad Currency Co,bad@example.com,COMPANY,POUNDS,Leeds,',
  'Bad Email Co,not-an-email,COMPANY,USD,Leeds,',
].join('\n');

describe('client spreadsheet import', () => {
  let workspaceId: string;
  let userId: string;
  let fileId: string;

  beforeAll(async () => {
    prisma = await setupTestDatabase();
    importActions = await import('@/features/clients/import');
    storage = await import('@/lib/storage');
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  async function seedFile(contents: string, name = 'clients.csv') {
    const stored = await storage.putObject(workspaceId, name, Buffer.from(contents, 'utf8'));
    const file = await prisma.fileAsset.create({
      data: {
        workspaceId,
        uploadedById: userId,
        storageKey: stored.storageKey,
        originalName: name,
        mimeType: 'text/csv',
        byteSize: stored.byteSize,
        checksum: stored.checksum,
        scanStatus: 'SKIPPED',
      },
      select: { id: true },
    });
    return file.id;
  }

  beforeEach(async () => {
    await resetTestData();

    const workspace = await prisma.workspace.create({
      data: { name: 'Import Office', baseCurrency: 'PKR' },
    });
    workspaceId = workspace.id;

    const user = await prisma.user.create({
      data: {
        name: 'Manager',
        email: 'manager@example.com',
        memberships: { create: { workspaceId, role: 'MANAGER' } },
      },
    });
    userId = user.id;

    setActionContext(makeContext({ workspaceId, userId, role: 'MANAGER' }));
    fileId = await seedFile(CSV);
  });

  describe('preview', () => {
    it('reads headers and suggests a mapping', async () => {
      const preview = expectOk(await importActions.previewClientImport({ fileId }));

      expect(preview.sheet.headers).toEqual([
        'Name',
        'Email',
        'Type',
        'Billing Currency',
        'City',
        'Tags',
      ]);
      expect(preview.sheet.rowCount).toBe(5);
      expect(preview.suggestedMapping.Name).toBe('name');
      expect(preview.suggestedMapping.Email).toBe('email');
      expect(preview.suggestedMapping['Billing Currency']).toBe('billingCurrency');
    });

    it('writes nothing', async () => {
      await importActions.previewClientImport({ fileId });
      expect(await prisma.client.count()).toBe(0);
    });

    it('refuses a file type it cannot read', async () => {
      const pdfId = await seedFile('%PDF-1.7 not really', 'report.pdf');
      const result = await importActions.previewClientImport({ fileId: pdfId });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('UNSUPPORTED');
    });
  });

  const mapping = {
    Name: 'name',
    Email: 'email',
    Type: 'type',
    'Billing Currency': 'billingCurrency',
    City: 'city',
    Tags: 'tags',
  };

  describe('validate', () => {
    it('reports every row-level error without writing', async () => {
      const validation = expectOk(await importActions.validateClientImport({ fileId, mapping }));

      expect(validation.totalRows).toBe(5);
      expect(validation.validRows).toBe(2);

      const fields = validation.errors.map((e) => e.field);
      expect(fields).toContain('name');
      expect(fields).toContain('billingCurrency');
      expect(fields).toContain('email');

      expect(await prisma.client.count()).toBe(0);
    });

    it('reports the spreadsheet row number, counting the header', async () => {
      const validation = expectOk(await importActions.validateClientImport({ fileId, mapping }));
      // The blank-name row is the third data row, line 4 of the file.
      const nameError = validation.errors.find((e) => e.field === 'name');
      expect(nameError?.row).toBe(4);
    });

    it('refuses to continue without a name mapping', async () => {
      const result = await importActions.validateClientImport({
        fileId,
        mapping: { Email: 'email' },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('MISSING_NAME_MAPPING');
    });

    it('flags rows matching an existing client', async () => {
      await prisma.client.create({
        data: {
          workspaceId,
          name: 'Northwind Trading',
          normalizedName: 'northwindtrading',
          billingCurrency: 'GBP',
        },
      });

      const validation = expectOk(await importActions.validateClientImport({ fileId, mapping }));
      expect(validation.duplicates).toHaveLength(1);
      expect(validation.duplicates[0]?.name).toBe('Northwind Trading');
    });
  });

  describe('commit', () => {
    it('creates only the valid rows', async () => {
      const result = expectOk(await importActions.commitClientImport({ fileId, mapping }));

      expect(result.imported).toBe(2);
      expect(await prisma.client.count()).toBe(2);

      const northwind = await prisma.client.findFirstOrThrow({
        where: { name: 'Northwind Trading' },
      });
      expect(northwind.billingCurrency).toBe('GBP');
      expect(northwind.type).toBe('COMPANY');
      expect(northwind.email).toBe('ap@northwind.example.com');
      expect(northwind.tags).toEqual(['retail', 'uk']);
      expect((northwind.addressJson as { city: string }).city).toBe('London');

      const individual = await prisma.client.findFirstOrThrow({
        where: { name: 'Imran Sheikh' },
      });
      expect(individual.type).toBe('INDIVIDUAL');
      expect(individual.billingCurrency).toBe('PKR');
    });

    it('skips duplicates unless explicitly allowed', async () => {
      await prisma.client.create({
        data: {
          workspaceId,
          name: 'Northwind Trading',
          normalizedName: 'northwindtrading',
          billingCurrency: 'GBP',
        },
      });

      const skipped = expectOk(await importActions.commitClientImport({ fileId, mapping }));
      expect(skipped.imported).toBe(1);
      expect(skipped.skippedDuplicates).toBe(1);
      expect(await prisma.client.count()).toBe(2);
    });

    it('creates duplicates when the user confirms', async () => {
      await prisma.client.create({
        data: {
          workspaceId,
          name: 'Northwind Trading',
          normalizedName: 'northwindtrading',
          billingCurrency: 'GBP',
        },
      });

      const result = expectOk(
        await importActions.commitClientImport({ fileId, mapping, includeDuplicates: true }),
      );
      expect(result.imported).toBe(2);
      expect(await prisma.client.count()).toBe(3);
    });

    it('records the import job and an audit entry', async () => {
      expectOk(await importActions.commitClientImport({ fileId, mapping }));

      const job = await prisma.importJob.findFirst({ where: { workspaceId } });
      expect(job?.status).toBe('COMMITTED');
      expect(job?.importedRows).toBe(2);
      expect(job?.totalRows).toBe(5);

      const audit = await prisma.auditLog.findFirst({
        where: { workspaceId, action: 'client.imported' },
      });
      expect(audit?.summary).toContain('2 client');
    });

    it('leaves the uploaded file untouched', async () => {
      expectOk(await importActions.commitClientImport({ fileId, mapping }));

      const file = await prisma.fileAsset.findUniqueOrThrow({ where: { id: fileId } });
      const bytes = await storage.getObject(file.storageKey);
      expect(bytes.toString('utf8')).toBe(CSV);
    });

    it('refuses when nothing is valid', async () => {
      const badId = await seedFile('Name,Email\n,nope\n', 'bad.csv');
      const result = await importActions.commitClientImport({
        fileId: badId,
        mapping: { Name: 'name', Email: 'email' },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('NOTHING_TO_IMPORT');
    });

    it('refuses a role without client:import', async () => {
      setActionContext(makeContext({ workspaceId, userId, role: 'STAFF' }));
      const result = await importActions.commitClientImport({ fileId, mapping });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('FORBIDDEN');
      expect(await prisma.client.count()).toBe(0);
    });
  });

  describe('data handling', () => {
    it('does not coerce values that look numeric', async () => {
      const id = await seedFile('Name,Tax ID\nZero Co,007\nDate Co,2026-01-01\n', 'coercion.csv');
      expectOk(
        await importActions.commitClientImport({
          fileId: id,
          mapping: { Name: 'name', 'Tax ID': 'taxId' },
        }),
      );

      const zero = await prisma.client.findFirstOrThrow({ where: { name: 'Zero Co' } });
      expect(zero.taxId).toBe('007');
    });

    it('keeps a formula-looking cell as literal text', async () => {
      const id = await seedFile('Name\n=SUM(A1:A9)\n', 'formula.csv');
      expectOk(await importActions.commitClientImport({ fileId: id, mapping: { Name: 'name' } }));

      const client = await prisma.client.findFirstOrThrow({
        where: { workspaceId, name: { startsWith: '=' } },
      });
      expect(client.name).toBe('=SUM(A1:A9)');
    });
  });
});
