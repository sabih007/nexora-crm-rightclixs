import { expect, test } from '@playwright/test';
import { statePath, unique } from './helpers';

/**
 * The end-to-end workflows the specification calls out.
 *
 * These drive the real UI against a real database, so they prove the
 * journeys actually work rather than that the pieces exist.
 */

test.describe('new client through to payment', () => {
  test.use({ storageState: statePath('owner') });

  test('create a client, raise an invoice, issue it and record a payment', async ({ page }) => {
    const clientName = unique('E2E Client');
    // A fresh email each run: the app's duplicate detection would otherwise
    // (correctly) flag a repeat of this test as a possible duplicate.
    const clientEmail = `${clientName.replace(/\W+/g, '-').toLowerCase()}@e2e.example.com`;

    // ---- create the client -------------------------------------------
    await page.goto('/clients/new');
    await page.getByRole('textbox', { name: 'Company name' }).fill(clientName);
    await page.getByRole('textbox', { name: 'Email' }).first().fill(clientEmail);
    await page.getByRole('combobox', { name: 'Billing currency' }).selectOption('USD');
    await page.getByRole('button', { name: 'Create client' }).click();

    await page.waitForURL(/\/clients\/[0-9a-f-]{36}/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: clientName, level: 1 })).toBeVisible();

    // ---- raise a draft invoice ---------------------------------------
    await page.getByRole('link', { name: 'New invoice' }).click();
    await page.waitForURL(/\/invoices\/new/);

    await page
      .getByRole('combobox', { name: 'Client' })
      .first()
      .selectOption({ label: `${clientName} (USD)` });
    await page.getByRole('textbox', { name: /Line 1 description/ }).fill('Consulting services');
    await page.getByRole('textbox', { name: /Line 1 quantity/ }).fill('10');
    await page.getByRole('textbox', { name: /Line 1 unit price/ }).fill('150');
    await page.getByRole('textbox', { name: /Line 1 tax rate/ }).fill('10');

    // The live preview uses the same engine the server does: 1500 + 150.
    await expect(page.getByText('$1,650.00').first()).toBeVisible();

    await page.getByRole('button', { name: 'Create draft' }).click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}/, { timeout: 20_000 });

    await expect(page.getByText('This is a draft')).toBeVisible();
    await expect(page.getByText('$1,650.00').first()).toBeVisible();

    // ---- issue it -----------------------------------------------------
    await page.getByRole('button', { name: 'Issue invoice' }).click();
    await page.getByRole('button', { name: 'Issue invoice' }).last().click();

    await expect(page.getByText('Issued snapshot')).toBeVisible({ timeout: 20_000 });
    // An issued invoice can no longer be edited.
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);

    // ---- record a partial payment -------------------------------------
    await page.getByRole('button', { name: 'Record payment' }).first().click();
    const amount = page.getByRole('textbox', { name: /Amount \(USD\)/ });
    await amount.fill('650');
    await page.getByRole('button', { name: 'Record payment' }).last().click();

    await expect(page.getByText('Partially paid')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Balance due')).toBeVisible();
    await expect(page.getByText('$1,000.00').first()).toBeVisible();

    // ---- settle the rest ----------------------------------------------
    await page.getByRole('button', { name: 'Record payment' }).first().click();
    await page.getByRole('textbox', { name: /Amount \(USD\)/ }).fill('1000');
    await page.getByRole('button', { name: 'Record payment' }).last().click();

    await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('card footprint', () => {
  test.use({ storageState: statePath('owner') });

  test('add a card, record where it is saved, then mark it removed', async ({ page }) => {
    const nickname = unique('E2E Card');
    const platformName = unique('E2E Platform');

    // ---- the platform --------------------------------------------------
    await page.goto('/subscriptions/platforms');
    await page.getByRole('button', { name: 'Add a platform' }).click();
    await page.getByRole('textbox', { name: 'Name' }).first().fill(platformName);
    await page.getByRole('button', { name: 'Add platform' }).click();
    await expect(page.getByText(platformName).first()).toBeVisible({ timeout: 20_000 });

    // ---- the card ------------------------------------------------------
    await page.goto('/subscriptions/cards');
    await page.getByRole('button', { name: 'Add a card' }).click();
    await page.getByRole('textbox', { name: 'Nickname' }).fill(nickname);
    await page.getByRole('textbox', { name: 'Issuing bank' }).fill('E2E Bank');
    await page.getByRole('textbox', { name: 'Last four digits' }).fill('4242');
    await page.getByRole('button', { name: 'Add card' }).click();

    await expect(page.getByText(nickname).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('···· 4242').first()).toBeVisible();

    // ---- link the card to the platform ----------------------------------
    await page.getByRole('button', { name: `Link a platform to ${nickname}` }).click();
    await page.getByRole('combobox', { name: 'Platform' }).selectOption({ label: platformName });
    await page.getByRole('button', { name: 'Record link' }).click();

    await expect(page.getByText(platformName).first()).toBeVisible({ timeout: 20_000 });

    // ---- mark it removed -------------------------------------------------
    await page
      .getByRole('button', { name: new RegExp(`Mark ${nickname} removed from`) })
      .first()
      .click();
    await page.getByRole('button', { name: 'Record removal' }).click();

    await expect(page.getByText(/removed/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('the card form offers no field for a full card number', async ({ page }) => {
    await page.goto('/subscriptions/cards');
    await page.getByRole('button', { name: 'Add a card' }).click();

    // Only the last four digits are collectable, and the form says so.
    await expect(page.getByText(/Only the last four digits are stored/i)).toBeVisible();
    await expect(page.getByRole('textbox', { name: /card number/i })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /cvv|cvc|security code|pin/i })).toHaveCount(0);

    const last4 = page.getByRole('textbox', { name: 'Last four digits' });
    await last4.fill('4111111111111111');
    // The input refuses more than four digits rather than truncating silently.
    await expect(last4).toHaveValue('4111');
  });
});

test.describe('project delivery', () => {
  test.use({ storageState: statePath('owner') });

  test('create a project and move a task across the board', async ({ page }) => {
    const projectName = unique('E2E Project');

    await page.goto('/projects/new');
    await page.getByRole('textbox', { name: 'Name' }).first().fill(projectName);
    await page.getByRole('button', { name: 'Create project' }).click();

    await page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: projectName, level: 1 })).toBeVisible();

    // ---- add a task -----------------------------------------------------
    await page.getByRole('button', { name: 'Add the first task' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Kick-off meeting');
    await page.getByRole('button', { name: 'Create task' }).click();

    await expect(page.getByText('Kick-off meeting')).toBeVisible({ timeout: 20_000 });

    // ---- move it with the status control --------------------------------
    await page.getByRole('button', { name: 'Open task: Kick-off meeting' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Status' }).selectOption('DONE');
    await dialog.getByRole('button', { name: 'Save changes' }).click();

    // Project completion reflects the change.
    await expect(page.getByText('100%')).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('reporting', () => {
  test.use({ storageState: statePath('finance') });

  test('the dashboard distinguishes cash collected from invoiced revenue', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.getByText('Cash collected').first()).toBeVisible();
    await expect(page.getByText('Invoiced revenue').first()).toBeVisible();

    // The definitions panel states the difference explicitly.
    await expect(page.getByText('How these figures are calculated')).toBeVisible();
    await expect(page.getByText(/cash in hand — not what was billed/i)).toBeVisible();
  });

  test('reports are labelled as management reporting, not statements', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByText(/Management reporting, not financial statements/i)).toBeVisible();
  });

  test('a report exports as CSV', async ({ page }) => {
    await page.goto('/reports');

    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
    await page.getByRole('link', { name: 'Export CSV' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^nexora-report-.*\.csv$/);
  });

  test('a report exports as PDF', async ({ page }) => {
    await page.goto('/reports');

    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
    await page.getByRole('link', { name: 'Export PDF' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^nexora-report-.*\.pdf$/);

    // A real PDF, not an error page with the wrong content type.
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});

test.describe('subscriptions', () => {
  test.use({ storageState: statePath('finance') });

  test('the forecast is labelled as expected, not spent', async ({ page }) => {
    await page.goto('/subscriptions');

    await expect(page.getByText(/Every figure below is an/i)).toBeVisible();
    await expect(page.getByText(/Nexora OS never charges a card/i)).toBeVisible();
    await expect(page.getByText('Monthly commitment').first()).toBeVisible();
  });

  test('the renewal calendar lists individual expected charges', async ({ page }) => {
    await page.goto('/subscriptions/calendar');
    await expect(page.getByText(/These are forecasts, not payments/i)).toBeVisible();
  });
});
