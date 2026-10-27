import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests.
 *
 * Runs against a production build on port 3210 with the development PGlite
 * database, which must already be running (`npm run db:start`). The suite
 * signs in as the seeded demo accounts, so run `npm run db:seed` first.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3210',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npx next start -p 3210',
        url: 'http://127.0.0.1:3210/api/health',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
