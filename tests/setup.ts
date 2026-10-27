import { config as loadEnv } from 'dotenv';

/**
 * Test environment bootstrap.
 *
 * Loads .env.local for local secrets, then forces the values tests rely on.
 * Integration tests get their own PGlite database (see `tests/helpers/db.ts`)
 * so they never touch the development data in `.pgdata`.
 */

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

process.env.NODE_ENV = 'test';
process.env.AUTH_SECRET ??= 'test-auth-secret-value-at-least-32-characters-long';
process.env.CRON_SECRET ??= 'test-cron-secret-value';
process.env.APP_URL ??= 'http://localhost:3000';
process.env.STORAGE_DRIVER = 'local';
process.env.EMAIL_DRIVER = 'log';
process.env.LOG_LEVEL = 'error';
process.env.WORKSPACE_BASE_CURRENCY ??= 'PKR';
// Never let a test run against the real DATABASE_URL by accident.
process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/testdb?schema=public';
