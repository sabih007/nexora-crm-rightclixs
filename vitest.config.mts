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
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // `server-only` throws unless resolved under the `react-server`
      // condition, which Vitest's Node transform does not apply. Point it at
      // an empty stub so server modules can be imported directly in tests.
      'server-only': path.resolve(import.meta.dirname, './tests/stubs/server-only.ts'),
    },
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
