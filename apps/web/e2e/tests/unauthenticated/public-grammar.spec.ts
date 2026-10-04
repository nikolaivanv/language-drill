import { test, expect } from '@playwright/test';

// These pages must work with no session at all — the `unauthenticated`
// project already runs with a clean (consent-only) storageState, so no
// extra `test.use` override is needed here, unlike the sign-in spec which
// drives the Clerk UI directly.

// FULL STACK ONLY, and for a reason that cannot be worked around with the
// house `page.route` pattern: these pages fetch their content in a SERVER
// component, so the request leaves the Next server rather than the browser.
// `page.route` intercepts browser traffic only, so it cannot stub them — that
// is the same property that makes the articles crawlable, and it is not
// something to engineer away here.
//
// Without a reachable API the server fetch throws by design (see
// `apps/web/lib/public-theory.ts`: a 5xx or network failure must NOT become a
// 404, or a transient outage would teach Google that 312 live URLs are gone),
// so the page 500s. In CI `NEXT_PUBLIC_API_URL` is baked to
// `http://localhost:3001` with nothing listening, which is exactly that case.
//
// So this follows the same gate as the drill/theory smoke tests in
// `mobile-responsive.spec.ts`: run against a preview deploy
// (`PLAYWRIGHT_BASE_URL`) or a local full stack, and skip otherwise. The
// regression these pages most need guarded — that the Clerk middleware keeps
// every public grammar URL public — is covered on every PR by
// `apps/web/__tests__/proxy.test.ts`, which needs no server at all.
//
// To run it locally, `E2E_FULL_STACK=1` is NOT sufficient on its own. Playwright
// starts the web server with this package's own `dev` script, which does not
// carry the root `pnpm dev:web`'s inline API-URL override, so it reads the
// placeholder `NEXT_PUBLIC_API_URL` out of `apps/web/.env` and the server fetch
// fails anyway. Point it at the local API explicitly:
//
//   pnpm dev:api                                   # in another shell, port 3001
//   E2E_FULL_STACK=1 NEXT_PUBLIC_API_URL=http://localhost:3001 \
//     pnpm --filter @language-drill/web exec playwright test \
//     --project=unauthenticated --grep grammar
//
// Verified passing 4/4 that way against the dev database (ES ~114 topics).
const FULL_STACK =
  !!process.env['PLAYWRIGHT_BASE_URL'] || process.env['E2E_FULL_STACK'] === '1';

test.skip(
  !FULL_STACK,
  'needs a reachable API: the pages render server-side, so page.route cannot stub them',
);

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
