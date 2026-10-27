/**
 * Reset the development database: drop everything, migrate, reseed.
 *
 *   npm run db:reset
 *
 * Destructive, and deliberately hard to run by accident:
 *  • refuses outright when NODE_ENV=production;
 *  • refuses when DATABASE_URL does not look like a local database, unless
 *    --i-know-what-im-doing is passed.
 */
import { execFileSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

function run(command: string, args: string[]) {
  execFileSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: true,
  });
}

function looksLocal(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

async function main() {
  const force = process.argv.includes('--i-know-what-im-doing');
  const url = process.env.DATABASE_URL ?? '';

  if (process.env.NODE_ENV === 'production') {
    console.error('\n  Refusing to reset the database with NODE_ENV=production.\n');
    process.exit(1);
  }

  if (!looksLocal(url) && !force) {
    console.error('\n  DATABASE_URL does not point at localhost.');
    console.error('  This would destroy data on a remote database.');
    console.error('  Re-run with --i-know-what-im-doing if that is genuinely intended.\n');
    process.exit(1);
  }

  const { prisma } = await import('../src/lib/db');

  console.log('\n  Dropping the public schema…');
  await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  await prisma.$disconnect();

  console.log('  Applying migrations…');
  run('npx', ['prisma', 'migrate', 'deploy']);

  console.log('  Seeding demo data…');
  run('npx', ['tsx', '--conditions=react-server', 'prisma/seed.ts']);

  console.log('\n  Done. The database has been rebuilt from the migrations.\n');
}

main().catch((error) => {
  console.error('Reset failed:', error);
  process.exit(1);
});
