import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

/**
 * Integration-test database.
 *
 * Boots a throwaway PGlite instance (real PostgreSQL, compiled to WASM) and
 * exposes it over the Postgres wire protocol on an ephemeral port, so Prisma
 * talks to it exactly as it would to a managed PostgreSQL server. The schema
 * is applied from the checked-in migration files — the same SQL production
 * runs — rather than from a push, so a broken migration fails the test suite.
 */

let db: PGlite | null = null;
let server: PGLiteSocketServer | null = null;
let client: PrismaClient | null = null;
let dataDir: string | null = null;
let port = 0;

/**
 * Apply the checked-in migration SQL in filename order.
 *
 * Executed straight against PGlite rather than by shelling out to the Prisma
 * CLI: it is the same SQL production applies, runs in milliseconds, and avoids
 * spawning a .cmd shim on Windows.
 */
async function applyMigrations(instance: PGlite): Promise<void> {
  const migrationsDir = path.join(process.cwd(), 'prisma', 'migrations');
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (dirs.length === 0) throw new Error('No migrations found to apply.');

  for (const dir of dirs) {
    const sql = readFileSync(path.join(migrationsDir, dir, 'migration.sql'), 'utf8');
    await instance.exec(sql);
  }
}

/** Pick a free localhost port by binding one and releasing it. */
async function freePort(): Promise<number> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (typeof address === 'object' && address) {
        const found = address.port;
        srv.close(() => resolve(found));
      } else {
        srv.close(() => reject(new Error('Could not determine a free port')));
      }
    });
  });
}

export async function setupTestDatabase(): Promise<PrismaClient> {
  if (client) return client;

  dataDir = mkdtempSync(path.join(tmpdir(), 'nexora-test-'));
  db = await PGlite.create({ dataDir });
  port = await freePort();

  // PGlite defaults to a single concurrent connection; node-postgres keeps a
  // small pool and reconnects after a failed statement, so allow headroom.
  server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 20 });
  await server.start();

  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?schema=public`;
  process.env.DATABASE_URL = url;

  await applyMigrations(db);

  client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 4, idleTimeoutMillis: 0 }),
  });
  return client;
}

export function getTestPrisma(): PrismaClient {
  if (!client) throw new Error('setupTestDatabase() must run before getTestPrisma()');
  return client;
}

export async function teardownTestDatabase(): Promise<void> {
  await client?.$disconnect();
  await server?.stop();
  await db?.close();
  if (dataDir) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* Windows occasionally holds the handle briefly; the temp dir is disposable. */
    }
  }
  client = null;
  server = null;
  db = null;
  dataDir = null;
}

/**
 * Empty every business table between tests while keeping the schema.
 * TRUNCATE ... CASCADE is far faster than deleting in dependency order.
 */
export async function resetTestData(): Promise<void> {
  const prisma = getTestPrisma();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
