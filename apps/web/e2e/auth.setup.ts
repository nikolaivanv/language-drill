// Playwright "setup" project entry.
//
// This file runs once at the start of each `pnpm test:e2e` invocation,
// before any tests in the `authenticated` project execute. It performs the
// one-time work of:
//
//   1. Validating env (fast-fail on missing vars or a `pk_live_` key).
//   2. Reusing a fresh, on-disk storageState if one is available — so
//      steady-state runs add no Clerk Backend API round-trip.
//   3. Otherwise: calling `clerkSetup()` to obtain the dev-instance
//      Testing Token, provisioning the canonical E2E test user in Clerk +
//      Postgres, signing in programmatically via `clerk.signIn` (email
//      strategy → server-side ticket), and persisting the resulting
//      session cookies as `storage-state.json`.
//   4. Writing `test-user.json` so a developer can align the Lambda dev
//      server with the same identity via
//      `DEV_USER_ID=$(jq -r .userId apps/web/e2e/.auth/test-user.json) pnpm dev:api`
//      (see docs/testing.md).
//
// Errors are re-thrown with a `[auth.setup]` prefix so failures in this
// stage are unambiguously distinguishable from spec failures in the
// Playwright HTML report.

import { test as setup } from '@playwright/test';
import { clerkSetup } from '@clerk/testing/playwright';

import { createTestUser, signInProgrammatically } from './helpers/auth';
import { assertE2EEnv } from './helpers/env';
import {
  STORAGE_STATE_PATH,
  isStorageStateFresh,
  readTestUserManifest,
  writeTestUserManifest,
} from './helpers/test-user';

setup('authenticate', async ({ page }) => {
  try {
    const env = assertE2EEnv();

    const fresh = await isStorageStateFresh(env.storageStateTtlMinutes);
    const manifest = await readTestUserManifest();
    if (fresh && manifest) {
      console.log(
        `[auth.setup] Reusing cached storage state (age < ${env.storageStateTtlMinutes}m, user ${manifest.userId}).`,
      );
      return;
    }

    await clerkSetup();

    const { userId, email, created } = await createTestUser();
    console.log(
      `[auth.setup] ${created ? 'Provisioned' : 'Reused'} Clerk user ${userId} (${email}).`,
    );

    await signInProgrammatically(page);

    await page.context().storageState({ path: STORAGE_STATE_PATH });

    await writeTestUserManifest({
      userId,
      email,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[auth.setup] ${message}`, { cause: err });
  }
});
