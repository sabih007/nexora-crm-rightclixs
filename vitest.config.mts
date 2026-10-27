import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Two projects:
 *  • unit        — pure logic (money, cadence, rounding). No database.
 *  • integration — runs against a real PostgreSQL engine (PGlite in-process),
 *                  migrated and truncated between files.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    setupFiles: ['tests/setup.ts'],
    // PGlite is a single in-process database; parallel files would collide.
    pool: 'forks',
    maxForks: 1,
    minForks: 1,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/lib/**', 'src/features/**'],
      exclude: ['src/generated/**', '**/*.tsx'],
    },
  },
});
