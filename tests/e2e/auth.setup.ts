import { test as setup, expect } from '@playwright/test';
import { ACCOUNTS, DEMO_PASSWORD, statePath, type AccountKey } from './helpers';

/**
 * Signs in once per role and saves the browser state.
 *
 * The specs then reuse that state instead of signing in again for every
 * test: the suite runs far faster, and it does not generate dozens of
 * authentication attempts from one address — which the rate limiter would
 * rightly treat as suspicious.
 */

for (const role of Object.keys(ACCOUNTS) as AccountKey[]) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email address' }).fill(ACCOUNTS[role]);
    await page.getByRole('textbox', { name: 'Password' }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

    await page.context().storageState({ path: statePath(role) });
  });
}
