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

// `process.env.NODE_ENV` is typed read-only; the mutable view is still the
// same object, and Vitest expects the test environment to be declared here.
const mutableEnv = process.env as Record<string, string | undefined>;

mutableEnv.NODE_ENV = 'test';
mutableEnv.AUTH_SECRET ??= 'test-auth-secret-value-at-least-32-characters-long';
mutableEnv.CRON_SECRET ??= 'test-cron-secret-value';
mutableEnv.APP_URL ??= 'http://localhost:3000';
mutableEnv.STORAGE_DRIVER = 'local';
mutableEnv.EMAIL_DRIVER = 'log';
mutableEnv.LOG_LEVEL = 'error';
mutableEnv.WORKSPACE_BASE_CURRENCY ??= 'PKR';
// Never let a test run against the real DATABASE_URL by accident.
mutableEnv.DATABASE_URL = 'postgresql://test:test@localhost:1/testdb?schema=public';
