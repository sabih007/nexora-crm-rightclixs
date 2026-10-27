import { expect, test } from '@playwright/test';
import { ACCOUNTS, DEMO_PASSWORD, signIn, signOut, statePath } from './helpers';

/**
 * Smoke suite: every navigable page loads for an authorised role, and the
 * access boundaries hold for an unauthorised one.
 */

test.describe('authentication', () => {
  // These exercise the login path itself, so they start with no session.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('an anonymous visitor is sent to the login page', async ({ page }) => {
    await page.goto('/clients');
    await page.waitForURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('the wrong password is refused without revealing whether the account exists', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email address' }).fill(ACCOUNTS.admin);
    await page.getByRole('textbox', { name: 'Password' }).fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText(/do not match an active account/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('an unknown account gets the same message as a wrong password', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email address' }).fill('nobody-here@example.com');
    await page.getByRole('textbox', { name: 'Password' }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText(/do not match an active account/i)).toBeVisible();
  });

  test('sign in and out', async ({ page }) => {
    await signIn(page, 'admin');
    await signOut(page);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});

test.describe('navigation as an admin', () => {
  test.use({ storageState: statePath('admin') });

  const pages: { path: string; heading: RegExp }[] = [
    { path: '/dashboard', heading: /Overview/ },
    { path: '/clients', heading: /Clients/ },
    { path: '/invoices', heading: /Invoices/ },
    { path: '/projects', heading: /Projects/ },
    { path: '/files', heading: /Sheets & Files/ },
    { path: '/subscriptions', heading: /Subscriptions/ },
    { path: '/subscriptions/cards', heading: /Subscriptions/ },
    { path: '/subscriptions/platforms', heading: /Subscriptions/ },
    { path: '/subscriptions/calendar', heading: /Subscriptions/ },
    { path: '/subscriptions/expenses', heading: /Subscriptions/ },
    { path: '/reports', heading: /Reports/ },
    { path: '/activity', heading: /Activity Log/ },
    { path: '/team', heading: /Team & Roles/ },
    { path: '/settings', heading: /Settings/ },
    { path: '/settings/profile', heading: /Profile & security/ },
    { path: '/settings/exchange-rates', heading: /Exchange rates/ },
  ];

  for (const entry of pages) {
    test(`${entry.path} renders`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      const response = await page.goto(entry.path);
      expect(response?.status(), `${entry.path} should not error`).toBeLessThan(400);
      await expect(page.getByRole('heading', { name: entry.heading, level: 1 })).toBeVisible();

      expect(errors, `${entry.path} threw in the browser`).toEqual([]);
    });
  }

  test('the seeded demo data is visible on the clients list', async ({ page }) => {
    await page.goto('/clients');
    await expect(page.getByText('[DEMO] Harbour Logistics Ltd').first()).toBeVisible();
  });

  test('an invoice detail page shows its billing panel', async ({ page }) => {
    await page.goto('/invoices');
    await page.getByRole('link', { name: /INV-/ }).first().click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}/);
    await expect(page.getByText('Bill to')).toBeVisible();
    await expect(page.getByText('Timeline')).toBeVisible();
  });
});

test.describe('role boundaries as staff', () => {
  test.use({ storageState: statePath('staff') });

  test('a staff member cannot reach invoices, cards or the activity log', async ({ page }) => {
    for (const path of ['/invoices', '/subscriptions/cards', '/activity']) {
      await page.goto(path);
      // The page renders, but with an explicit "No access" state rather than data.
      await expect(page.getByText(/No access/i).first()).toBeVisible();
    }
  });

  test('the sidebar hides sections a staff member cannot use', async ({ page }) => {
    await page.goto('/dashboard');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Clients' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Invoices' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Activity Log' })).toHaveCount(0);
  });

});

test.describe('role boundaries as a manager', () => {
  test.use({ storageState: statePath('manager') });

  test('a manager sees invoices read-only, with no new-invoice action', async ({ page }) => {
    await page.goto('/invoices');
    await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New invoice' })).toHaveCount(0);
  });
});

test.describe('api boundaries', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the cron endpoint rejects an unauthenticated call', async ({ request }) => {
    const response = await request.get('/api/cron/reminders');
    expect(response.status()).toBe(401);
  });

  test('the search endpoint rejects an unauthenticated call', async ({ request }) => {
    const response = await request.get('/api/search?q=demo');
    expect(response.status()).toBe(401);
  });

  test('the health endpoint is public and reports the database', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.checks.database).toBe('up');
  });

  test('security headers are present', async ({ request }) => {
    const response = await request.get('/login');
    const headers = response.headers();
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});
