import { expect, test } from '@playwright/test';

test('renders authenticated landing page', async ({ page }) => {
  await page.goto('/');
  // Two assertions prove the storage state authenticated the request:
  //   1. We are NOT bounced to /sign-in (Clerk middleware lets us through).
  //   2. The app shell rendered — `<title>Language Drill</title>` from
  //      app/layout.tsx is stable across every signed-in route
  //      (dashboard, onboarding, settings) and survives the dashboard's
  //      "failed to load your profile" branch when no local API is
  //      running (which is the default Playwright webServer setup).
  await expect(page).not.toHaveURL(/\/sign-in/);
  await expect(page).toHaveTitle(/Language Drill/i);
});
