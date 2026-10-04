import { test, expect } from '@playwright/test';

// These pages must work with no session at all — the `unauthenticated`
// project already runs with a clean (consent-only) storageState, so no
// extra `test.use` override is needed here, unlike the sign-in spec which
// drives the Clerk UI directly.

test('the grammar hub lists topics without a session', async ({ page }) => {
  const response = await page.goto('/spanish/grammar');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/spanish\/grammar$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/grammar/i);
  const links = page.locator('[data-topic-row] a');
  expect(await links.count()).toBeGreaterThan(20);
});

test('a topic page renders its article and does not redirect', async ({ page }) => {
  await page.goto('/spanish/grammar');
  const first = page.locator('[data-topic-row] a').first();
  const href = await first.getAttribute('href');
  const response = await page.goto(href!);
  expect(response?.status()).toBe(200);
  await expect(page).not.toHaveURL(/sign-in/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.theory-section')).not.toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'On this page' })).toBeVisible();
});

test('search filters the list without removing it from the document', async ({ page }) => {
  await page.goto('/spanish/grammar');
  const total = await page.locator('[data-topic-row]').count();
  await page.getByLabel('Search topics').fill('zzzzznotatopic');
  await expect(page.locator('[data-topic-row]:visible')).toHaveCount(0);
  // Still in the DOM — the crawler's copy of the list is the markup, not state.
  expect(await page.locator('[data-topic-row]').count()).toBe(total);
});
