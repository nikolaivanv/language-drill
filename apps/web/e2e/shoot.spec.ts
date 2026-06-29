// `shoot` — non-asserting browser verification harness.
//
// Renders ONE authenticated route with seeded (non-empty) content and writes a
// screenshot to e2e/.shots/, so an agent can SEE a UI change instead of guessing.
// Driven entirely by env vars (set by `pnpm shoot`, see e2e/shoot-cli.mjs):
//
//   SHOOT_ROUTE  (required)  app path to render, e.g. /dashboard or /read
//   SHOOT_OUT    (optional)  output basename; default derived from the route
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
  await seedAll(page);

  await page.goto(targetRoute, { waitUntil: 'networkidle' });

  const name = process.env['SHOOT_OUT']?.trim() || routeToName(targetRoute);
  const outPath = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: outPath, fullPage: true });
  console.log(`[shoot] wrote ${outPath}`);
});
