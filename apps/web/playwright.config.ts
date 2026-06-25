// Playwright config for apps/web. Discovers tests under ./e2e/tests and
// runs them in three projects following Clerk's documented setup pattern:
//
//   - `setup`           — runs auth.setup.ts once; provisions the test
//                          user, signs in programmatically, writes the
//                          shared storageState.
//   - `authenticated`   — every spec under e2e/tests/authenticated; reuses
//                          the storageState so tests start signed in. Has
//                          a hard dependency on `setup`.
//   - `unauthenticated` — every spec under e2e/tests/unauthenticated; runs
//                          with a clean session so the Clerk sign-in UI
//                          itself can be exercised end-to-end.
//
// The web dev server is auto-started only when no `PLAYWRIGHT_BASE_URL` is
// provided; pass that env var to point the suite at a Vercel preview
// deploy instead.

import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

import { consentOrigin } from './e2e/helpers/consent';
import { STORAGE_STATE_PATH } from './e2e/helpers/test-user';

// Load `.env` so CLERK_SECRET_KEY / DATABASE_URL / E2E_CLERK_USER_EMAIL
// etc. are available to env.ts. Keeping this at the config level means
// every helper can read process.env directly.
dotenv.config({ path: path.resolve(__dirname, '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const baseURL = process.env['PLAYWRIGHT_BASE_URL']?.trim() || 'http://localhost:3000';
const useWebServer = !process.env['PLAYWRIGHT_BASE_URL'];

// Consent-only storage state for the unauthenticated project: no cookies (keeps
// the clean Clerk session it requires) but a recorded cookie-consent choice so
// the first-visit banner never mounts over the sign-in UI.
const consentOnlyState = { cookies: [], origins: [consentOrigin(baseURL)] };

export default defineConfig({
  testDir: './e2e/tests',
  outputDir: './test-results',
  // Runs once before any worker spawns; primes CLERK_TESTING_TOKEN so the
  // unauthenticated project (which doesn't depend on `setup`) can call
  // `setupClerkTestingToken` without a worker-local clerkSetup.
  globalSetup: require.resolve('./e2e/global-setup.ts'),

  // Locally fail fast; tolerate flake in CI.
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  // The setup project produces the storageState before authenticated tests
  // run; both are otherwise free to parallelize. The unauthenticated
  // project overrides this on its own entry (only one spec; serial).
  fullyParallel: true,

  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'setup',
      // The setup file lives at `e2e/auth.setup.ts`, outside the global
      // `testDir: './e2e/tests'` — override here so Playwright actually
      // discovers it.
      testDir: './e2e',
      testMatch: /auth\.setup\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'authenticated',
      testDir: './e2e/tests/authenticated',
      // The mobile-responsive spec runs only in `authenticated-mobile` (it
      // drives a phone-width viewport); exclude it from the desktop project.
      testIgnore: /mobile-responsive\.spec\.ts$/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE_PATH,
      },
    },
    {
      // Phone-width regression project (402×874 — matches the `mobile:` CSS
      // variant's ≤760 media query). Reuses the signed-in storageState. Only
      // the mobile-responsive smoke spec runs here; its desktop-guard block
      // overrides the viewport back to a wide size inline.
      name: 'authenticated-mobile',
      testDir: './e2e/tests/authenticated',
      testMatch: /mobile-responsive\.spec\.ts$/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE_PATH,
        viewport: { width: 402, height: 874 },
      },
    },
    {
      name: 'unauthenticated',
      testDir: './e2e/tests/unauthenticated',
      // Depends on setup so the canonical E2E user is provisioned in
      // Clerk before signInThroughUI tries to sign in as it — Clerk's
      // `+clerk_test` reserved pattern suppresses email delivery but does
      // NOT auto-create accounts.
      dependencies: ['setup'],
      // No auth cookies — each spec drives the Clerk UI from a clean session.
      // Serial so the OTP flow isn't racing parallel tabs. The consent-only
      // state carries no cookies, just the seeded cookie-consent choice.
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'], storageState: consentOnlyState },
    },
  ],

  ...(useWebServer
    ? {
        webServer: {
          // In CI, serve a PRODUCTION build (`next start`, after a `build`
          // step) — `next dev` enables React StrictMode, whose simulated
          // unmount/remount drops a start-on-mount mutation's per-call
          // `onSuccess` (TanStack v5), breaking e.g. the review-session start.
          // Locally, `next dev` is fine and needs no build.
          command: process.env['CI']
            ? 'pnpm --filter @language-drill/web start'
            : 'pnpm --filter @language-drill/web dev',
          // Probe a public route — `/` is rewritten to a 404 by Clerk's
          // middleware until the browser completes its dev-browser
          // handshake, which curl/Playwright's HTTP health probe can't do.
          // `/sign-in` is in the middleware's public matcher list.
          url: 'http://localhost:3000/sign-in',
          reuseExistingServer: !process.env['CI'],
          timeout: 120_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      }
    : {}),
});
