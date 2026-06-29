// `shoot` — non-asserting browser verification harness.
//
// Renders ONE authenticated route with seeded (non-empty) content and writes a
// screenshot to e2e/.shots/, so an agent can SEE a UI change instead of guessing.
// Driven entirely by env vars (set by `pnpm shoot`, see e2e/shoot-cli.mjs):
//
//   SHOOT_ROUTE     (required)  app path to render, e.g. /read or /review (dashboard landing is /home;
//                               / is the public marketing landing that redirects to /home when signed in)
//   SHOOT_OUT       (optional)  output basename; default derived from the route
//   SHOOT_THEME     (optional)  light | dark | system (default: system)
//   SHOOT_VIEWPORT  (optional)  desktop | mobile (default: desktop)
//   SHOOT_WAIT      (optional)  CSS or Playwright selector to wait for before screenshotting
//                               (e.g. `text=Heading`, `role=textbox`) — bare prose silently never matches
//   SHOOT_ANIMATE   (optional)  1 → capture an 8-frame sequence over 180 ms intervals
//   SHOOT_FULL_STACK (optional) 1 → skip seedAll and hit the real backend instead
//
// With no SHOOT_ROUTE the single test self-skips, so this file is inert during a
// normal `test:e2e` run. Auth comes from the storageState the `setup` project
// produced — there is no sign-in here and no Clerk handshake to stall on.

import path from 'node:path';
import { mkdir } from 'node:fs/promises';

import { test } from '@playwright/test';

import { seedAll } from './helpers/seed-mocks';

const SHOTS_DIR = path.resolve(__dirname, '.shots');

/** Turn a route into a filesystem-safe basename: /read/entries -> read-entries. */
function routeToName(route: string): string {
  const trimmed = route.replace(/^\/+|\/+$/g, '') || 'root';
  return trimmed.replace(/[^a-zA-Z0-9]+/g, '-');
}

test('shoot', async ({ page }) => {
  const route = process.env['SHOOT_ROUTE'];
  test.skip(!route, 'SHOOT_ROUTE not set — harness is inert (run via `pnpm shoot`).');
  const targetRoute = route as string;

  await mkdir(SHOTS_DIR, { recursive: true });

  // Viewport: mobile matches the app's ≤760 `mobile:` variant / authenticated-mobile.
  if (process.env['SHOOT_VIEWPORT'] === 'mobile') {
    await page.setViewportSize({ width: 402, height: 874 });
  }

  // Theme: seed localStorage before any app code runs, and align the OS media
  // query, so the pre-paint init script in lib/theme/theme.ts resolves correctly.
  const theme = process.env['SHOOT_THEME'] ?? 'system';
  if (theme === 'light' || theme === 'dark' || theme === 'system') {
    await page.addInitScript((t) => {
      try {
        window.localStorage.setItem('drill-theme', t);
      } catch {
        /* private mode — ignore, init script falls back to default */
      }
    }, theme);
    if (theme === 'dark') await page.emulateMedia({ colorScheme: 'dark' });
    if (theme === 'light') await page.emulateMedia({ colorScheme: 'light' });
  }

  // Content: seeded mocks by default; --full-stack skips them to hit the real
  // backend the running server points at (requires PLAYWRIGHT_BASE_URL + a wired
  // full stack — see docs/testing.md).
  if (process.env['SHOOT_FULL_STACK'] !== '1') {
    await seedAll(page);
  }

  await page.goto(targetRoute, { waitUntil: 'domcontentloaded' });

  // Wait for CONTENT, not network. `networkidle` fires in the quiet window
  // BEFORE the SPA issues its data fetches, so it captures the loading spinner.
  // Instead: an explicit --wait selector wins; otherwise let the page settle
  // (bounded networkidle) and wait for the app's loading spinners (.animate-spin
  // — used by the (dashboard) shell + page loading states) to detach. All bounded
  // and best-effort so a genuinely stuck route (e.g. an endpoint seedAll doesn't
  // mock) still produces a screenshot, with a warning instead of a hang/throw.
  const waitFor = process.env['SHOOT_WAIT']?.trim();
  if (waitFor) {
    await page.locator(waitFor).first().waitFor({ state: 'visible', timeout: 15_000 });
  } else {
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    try {
      await page.locator('.animate-spin').first().waitFor({ state: 'detached', timeout: 8_000 });
    } catch {
      console.warn(
        `[shoot] WARNING: a loading spinner was still present on ${targetRoute} ` +
          `after the wait — the screenshot may show a loading state. Pass ` +
          `--wait <content-selector>, or extend seedAll / use --full-stack if an ` +
          `endpoint this page fetches is unmocked.`,
      );
    }
  }
  // Brief settle so fonts, layout, and entry animations finish painting.
  await page.waitForTimeout(300);

  const name = process.env['SHOOT_OUT']?.trim() || routeToName(targetRoute);

  if (process.env['SHOOT_ANIMATE'] === '1') {
    // Capture a short frame sequence so a continuous/in-progress animation is
    // visible across stills. Note: this captures frames AFTER the page has
    // settled (spinners cleared), so it shows ongoing animation but CANNOT
    // replay a one-shot entry/mount transition (already finished by the time
    // capture starts) or an interaction-triggered animation (no interaction
    // driver here).
    const FRAMES = 8;
    const INTERVAL_MS = 180;
    for (let i = 0; i < FRAMES; i++) {
      // Inter-frame delay before all frames except the first.
      if (i > 0) await page.waitForTimeout(INTERVAL_MS);
      const frame = String(i).padStart(2, '0');
      // Intentionally viewport-only (not fullPage) so all frames are
      // comparable — a fullPage shot can vary in height between frames.
      await page.screenshot({ path: path.join(SHOTS_DIR, `${name}-frame-${frame}.png`) });
    }
    console.log(`[shoot] wrote ${FRAMES} frames to ${SHOTS_DIR}/${name}-frame-*.png`);
    return;
  }

  const outPath = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: outPath, fullPage: true });
  console.log(`[shoot] wrote ${outPath}`);
});
