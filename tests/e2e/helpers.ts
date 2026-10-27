import { expect, type Page } from '@playwright/test';

/**
 * Shared E2E helpers.
 *
 * Credentials come from the development seed (`npm run db:seed`), which
 * creates clearly-labelled [DEMO] accounts. They are not production
 * credentials and the seed refuses to run with NODE_ENV=production.
 */

export const DEMO_PASSWORD = 'NexoraDemo!2026';

export const ACCOUNTS = {
  owner: 'owner@example.com',
  admin: 'admin@example.com',
  finance: 'finance@example.com',
  manager: 'manager@example.com',
  staff: 'staff@example.com',
} as const;

export type AccountKey = keyof typeof ACCOUNTS;

/** Sign in and wait for the dashboard to be reachable. */
export async function signIn(page: Page, account: AccountKey = 'admin'): Promise<void> {
  await page.goto('/login');
  // Role-based queries use the accessible name, which excludes the
  // aria-hidden "*" the required-field label renders.
  await page.getByRole('textbox', { name: 'Email address' }).fill(ACCOUNTS[account]);
  await page.getByRole('textbox', { name: 'Password' }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Seeded accounts have no MFA enrolled, so this lands on the dashboard.
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL(/\/login/, { timeout: 15_000 });
}

/** A value unique to this run, so repeated runs never collide. */
export function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
