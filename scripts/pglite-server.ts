/**
 * Local development database server.
 *
 * Runs PGlite — PostgreSQL itself compiled to WebAssembly — and exposes it on
 * a TCP port speaking the genuine PostgreSQL wire protocol. Prisma, psql and
 * any other Postgres client connect to it normally.
 *
 * This exists only because the development machine has no PostgreSQL server
 * and no Docker. Production uses a real PostgreSQL instance; the only
 * difference is the value of DATABASE_URL.
 *
 *   npm run db:start
 */
import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const DATA_DIR = path.resolve(process.cwd(), '.pgdata');
const PORT = Number(process.env.PGLITE_PORT ?? 5434);
const HOST = process.env.PGLITE_HOST ?? '127.0.0.1';

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  const db = await PGlite.create({ dataDir: DATA_DIR });
  // gen_random_uuid() is in PostgreSQL core since 13 (PGlite tracks 17), so no
  // pgcrypto extension is required for the UUID primary-key defaults.
  const probe = await db.query<{ ok: string }>('SELECT gen_random_uuid()::text AS ok');
  if (!probe.rows[0]?.ok) throw new Error('gen_random_uuid() unavailable');

  // Next.js dev keeps several pooled connections open; the default of 1 would
  // reject them.
  const server = new PGLiteSocketServer({ db, port: PORT, host: HOST, maxConnections: 30 });
  await server.start();

  console.log(
    `\n  Nexora OS dev database (PGlite / PostgreSQL WASM)\n` +
      `  listening on postgresql://postgres:postgres@${HOST}:${PORT}/postgres\n` +
      `  data directory: ${DATA_DIR}\n` +
      `  press Ctrl+C to stop\n`,
  );

  const shutdown = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Failed to start dev database:', error);
  process.exit(1);
});
