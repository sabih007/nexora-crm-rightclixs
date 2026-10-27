import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Liveness + readiness probe.
 * Reports database reachability and which adapters are configured, without
 * revealing credentials or internal hostnames.
 */
export async function GET() {
  const startedAt = Date.now();
  let database: 'up' | 'down' = 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = 'up';
  } catch {
    database = 'down';
  }

  const body = {
    status: database === 'up' ? 'ok' : 'degraded',
    checks: {
      database,
      storageDriver: env.STORAGE_DRIVER,
      emailDriver: env.EMAIL_DRIVER,
    },
    latencyMs: Date.now() - startedAt,
    time: new Date().toISOString(),
  };

  return NextResponse.json(body, { status: database === 'up' ? 200 : 503 });
}
