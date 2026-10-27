/**
 * Author a new migration from the current schema.
 *
 *   npm run db:makemigration -- add_contract_table
 *
 * Why this exists instead of `prisma migrate dev`: that command needs a
 * throwaway *shadow database* to diff against, and the embedded development
 * database (PGlite) hosts exactly one. This produces the same artefact — a
 * timestamped folder of plain SQL under `prisma/migrations/` — by diffing
 * the applied migration history against the schema file.
 *
 * Review the generated SQL before applying it. `prisma migrate diff` does
 * not know your intent: a renamed column looks like a drop plus an add, and
 * it will not write the data-preserving version for you.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'prisma', 'migrations');
const SCHEMA = path.resolve(process.cwd(), 'prisma', 'schema.prisma');

function run(args: string[]): string {
  // `shell: true` so the npx shim resolves on Windows.
  return execFileSync('npx', args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    shell: true,
  });
}

function main() {
  const name = process.argv[2]?.trim();
  if (!name || !/^[a-z0-9_]+$/.test(name)) {
    console.error('\n  Give the migration a lower_snake_case name:');
    console.error('    npm run db:makemigration -- add_contract_table\n');
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const dir = path.join(MIGRATIONS_DIR, `${stamp}_${name}`);
  const file = path.join(dir, 'migration.sql');

  mkdirSync(dir, { recursive: true });

  try {
    const sql = run([
      'prisma',
      'migrate',
      'diff',
      '--from-migrations',
      MIGRATIONS_DIR,
      '--to-schema',
      SCHEMA,
      '--shadow-database-url',
      process.env.SHADOW_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
      '--script',
    ]);

    const body = sql
      .split('\n')
      .filter((line) => !line.startsWith('Loaded Prisma config'))
      .join('\n')
      .trim();

    if (!body) {
      rmSync(dir, { recursive: true, force: true });
      console.log('\n  The schema already matches the migration history. Nothing to do.\n');
      return;
    }

    writeFileSync(file, `${body}\n`, 'utf8');

    console.log(`\n  Wrote ${path.relative(process.cwd(), file)}\n`);
    console.log(readFileSync(file, 'utf8').split('\n').slice(0, 40).join('\n'));
    console.log('\n  Review it, add any CHECK constraints or data backfill it needs,');
    console.log('  then apply with:  npm run db:migrate\n');
  } catch (error) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    console.error('\n  Could not generate the migration.');
    console.error('  `migrate diff --from-migrations` needs a shadow database it can');
    console.error('  create and drop. Point SHADOW_DATABASE_URL at a scratch PostgreSQL');
    console.error('  database, or run this against a real PostgreSQL server.\n');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
