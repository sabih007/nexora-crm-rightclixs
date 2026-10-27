import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { env, isProduction } from './env';

/**
 * Prisma client singleton.
 *
 * Prisma 7 connects through a driver adapter; we use node-postgres so the same
 * code path works against local PGlite (which speaks the real wire protocol)
 * and against managed PostgreSQL in production.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: isProduction ? ['warn', 'error'] : ['warn', 'error'],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (!isProduction) globalForPrisma.prisma = prisma;

export type { PrismaClient };
