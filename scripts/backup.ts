/**
 * Database backup.
 *
 *   npm run db:backup                 # write .backups/nexora-<timestamp>.json
 *   npm run db:backup -- --out path   # choose the file
 *   npm run db:backup -- --verify f   # check a backup file is readable
 *
 * Produces a logical, portable JSON dump via Prisma, so it works against any
 * PostgreSQL target including the embedded development database — `pg_dump`
 * is not installed on every machine and cannot reach PGlite.
 *
 * For a production PostgreSQL server, `pg_dump` remains the better primary
 * backup (it captures roles, sequences and extensions). This script is the
 * portable fallback and the thing the restore drill exercises; both are
 * documented in docs/OPERATIONS.md.
 *
 * SECURITY: password hashes, TOTP secrets and session tokens are excluded by
 * default, so a backup file leaking does not hand over accounts. Pass
 * --include-credentials for a true full-fidelity dump, and treat that file
 * as a secret.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const BACKUP_DIR = path.resolve(process.cwd(), '.backups');

/** Order matters on restore: parents before children. */
const TABLES = [
  'workspace',
  'user',
  'membership',
  'client',
  'clientContact',
  'project',
  'projectMember',
  'task',
  'taskComment',
  'invoice',
  'invoiceLine',
  'payment',
  'paymentAllocation',
  'creditNote',
  'invoiceReminder',
  'folder',
  'fileAsset',
  'fileFolderLink',
  'importJob',
  'paymentCard',
  'platform',
  'platformCardLink',
  'subscription',
  'subscriptionReminder',
  'expense',
  'exchangeRate',
  'reminderRule',
  'notification',
  'jobExecution',
  'auditLog',
  'setting',
] as const;

const CREDENTIAL_FIELDS: Record<string, string[]> = {
  user: ['passwordHash', 'mfaSecretEnc', 'mfaRecoveryCodes'],
};

interface BackupFile {
  format: 'nexora-logical-backup';
  version: 1;
  createdAt: string;
  includesCredentials: boolean;
  counts: Record<string, number>;
  data: Record<string, unknown[]>;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  return {
    out: get('--out'),
    verify: get('--verify'),
    includeCredentials: args.includes('--include-credentials'),
  };
}

async function createBackup(outPath: string | undefined, includeCredentials: boolean) {
  const { prisma } = await import('../src/lib/db');

  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  for (const table of TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (prisma as any)[table];
    if (!delegate?.findMany) {
      console.warn(`  ! skipped unknown table "${table}"`);
      continue;
    }

    const rows: Record<string, unknown>[] = await delegate.findMany();
    const redactFields = includeCredentials ? [] : (CREDENTIAL_FIELDS[table] ?? []);

    data[table] = rows.map((row) => {
      if (redactFields.length === 0) return row;
      const copy = { ...row };
      for (const field of redactFields) {
        if (field in copy) copy[field] = null;
      }
      return copy;
    });

    counts[table] = rows.length;
    process.stdout.write(`  ${table}: ${rows.length}\n`);
  }

  const backup: BackupFile = {
    format: 'nexora-logical-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    includesCredentials: includeCredentials,
    counts,
    data,
  };

  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = outPath ?? path.join(BACKUP_DIR, `nexora-${stamp}.json`);

  // Decimal and Date serialise through their JSON forms, so the dump is
  // exact for money and timestamps.
  writeFileSync(target, JSON.stringify(backup, null, 2), 'utf8');

  const total = Object.values(counts).reduce((acc, n) => acc + n, 0);
  console.log(`\n  Backup written: ${target}`);
  console.log(`  ${total} rows across ${Object.keys(counts).length} tables.`);
  if (!includeCredentials) {
    console.log('  Password hashes and TOTP secrets were excluded.');
    console.log('  Use --include-credentials for a full-fidelity dump, and guard that file.');
  }

  await prisma.$disconnect();
}

function verifyBackup(file: string) {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as BackupFile;

  if (parsed.format !== 'nexora-logical-backup') {
    throw new Error('This file is not a Nexora backup.');
  }

  const total = Object.values(parsed.counts).reduce((acc, n) => acc + n, 0);
  const actual = Object.values(parsed.data).reduce((acc, rows) => acc + rows.length, 0);

  console.log(`\n  Backup: ${file}`);
  console.log(`  Created: ${parsed.createdAt}`);
  console.log(`  Credentials included: ${parsed.includesCredentials ? 'yes' : 'no'}`);
  console.log(`  Declared rows: ${total}`);
  console.log(`  Actual rows:   ${actual}`);

  for (const [table, count] of Object.entries(parsed.counts)) {
    const rows = parsed.data[table]?.length ?? 0;
    const flag = rows === count ? ' ' : '!';
    console.log(`   ${flag} ${table}: ${rows}/${count}`);
  }

  if (total !== actual) throw new Error('Row counts do not match the manifest — the file is damaged.');
  console.log('\n  The backup is internally consistent.\n');
}

async function main() {
  const args = parseArgs();

  if (args.verify) {
    verifyBackup(args.verify);
    return;
  }

  console.log('\n  Backing up…\n');
  await createBackup(args.out, args.includeCredentials);
}

main().catch((error) => {
  console.error('Backup failed:', error);
  process.exit(1);
});
