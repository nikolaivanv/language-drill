// E2E auth helpers — the single point where Clerk and Postgres are touched
// from the Playwright suite. Specs only call functions exported from this
// module; they never import @clerk/backend or @language-drill/db directly.
//
// Functions are added incrementally (tasks 5 → 6 → 7 of the
// playwright-clerk-testing spec):
//
//   - createTestUser           — idempotent provisioning in Clerk + Postgres
//   - signInProgrammatically   — server-token sign-in for the setup project (task 6)
//   - signInThroughUI          — UI smoke-test helper (task 7)

import { createClerkClient } from '@clerk/backend';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';
import type { Page } from '@playwright/test';

import { createDb, userLanguageProfiles, users } from '@language-drill/db';

import { assertE2EEnv } from './env';

export interface CreateTestUserOptions {
  /** Override the email; defaults to `E2E_CLERK_USER_EMAIL` from env. */
  email?: string;
  /** Override the password used at provisioning; defaults to
   *  `E2E_CLERK_USER_PASSWORD` from env. Only consumed when the user is
   *  newly created — existing users are not modified. */
  password?: string;
  /** Extra fields merged into the user's `publicMetadata` on create. The
   *  `e2eTestUser: true` flag is always set. */
  metadata?: Record<string, unknown>;
}

export interface CreateTestUserResult {
  /** Clerk-issued user ID (`user_2…`). */
  userId: string;
  email: string;
  /** True iff this call created the Clerk user (and therefore the DB row); false on a reused identity. */
  created: boolean;
}

/**
 * Idempotently provision the canonical E2E test user in Clerk and upsert
 * a matching row into the Postgres `users` table.
 *
 * Mirrors the pattern in `infra/lambda/src/dev.ts` — same Drizzle client,
 * same `onConflictDoNothing()` semantics — so the row shape this helper
 * writes is byte-identical to what the local Lambda dev server writes for
 * `dev_user_001`.
 *
 * Safe to call repeatedly: existing Clerk users are returned unchanged,
 * and `onConflictDoNothing()` makes the DB upsert a no-op when the row
 * already exists.
 */
export async function createTestUser(
  opts: CreateTestUserOptions = {},
): Promise<CreateTestUserResult> {
  const env = assertE2EEnv();
  const email = opts.email ?? env.testUserEmail;
  const password = opts.password ?? env.testUserPassword;

  const clerkClient = createClerkClient({ secretKey: env.clerkSecretKey });

  // 1) Find or create the Clerk identity.
  const existing = await clerkClient.users.getUserList({ emailAddress: [email] });
  let userId: string;
  let created = false;

  if (existing.data.length > 0) {
    userId = existing.data[0]!.id;
  } else {
    const newUser = await clerkClient.users.createUser({
      emailAddress: [email],
      password,
      skipPasswordChecks: true,
      publicMetadata: { e2eTestUser: true, ...opts.metadata },
    });
    userId = newUser.id;
    created = true;
  }

  // 2) Upsert the Postgres `users` row + a default language profile.
  //    FK constraints on user_exercise_history / usage_events require a
  //    row keyed by the Clerk user ID. The dashboard layout's
  //    `useLanguageProfiles` check redirects to /onboarding when no
  //    profile rows exist, so we seed one — matches design.md §Code
  //    Reuse "insert into users with onConflictDoNothing, then upsert
  //    language profiles". Both inserts are idempotent across repeat
  //    runs.
  const db = createDb(env.databaseUrl);
  await db.insert(users).values({ id: userId, email }).onConflictDoNothing();
  await db
    .insert(userLanguageProfiles)
    .values({ userId, language: 'es', proficiencyLevel: 'B1' })
    .onConflictDoNothing();

  return { userId, email, created };
}

export interface SignInProgrammaticallyOptions {
  /** Override the email; defaults to `E2E_CLERK_USER_EMAIL` from env. MUST contain `+clerk_test`. */
  email?: string;
}

/**
 * Programmatic sign-in used by the Playwright setup project to produce a
 * `storageState` that authenticated tests reuse.
 *
 * Uses the **`email_code` strategy**: `@clerk/testing/playwright`'s
 * `clerk.signIn` recognizes `+clerk_test` reserved emails, calls
 * `prepareFirstFactor` + `attemptFirstFactor` with the fixed `424242`
 * code, and persists the session — no real email is sent and no OTP UI
 * is touched. This matches the dev Clerk instance's enabled sign-in
 * method (the hosted UI shows an email-only "Continue" → OTP step, not
 * password). The `password` and `ticket` strategies were tried first and
 * fail against this instance: `password` is not enabled, and the
 * sign-in-token returned by `@clerk/backend` 3.x is rejected by
 * `@clerk/testing` 2.x's `signIn.create({ strategy: 'ticket' })`.
 *
 * Preconditions (enforced by `auth.setup.ts`, not re-checked here):
 *   1. `clerkSetup()` has run earlier in the same setup project.
 *   2. The target user exists in Clerk — created via `createTestUser`.
 *
 * The Clerk helper requires that the page have navigated to a route that
 * loads Clerk's frontend before being called. We navigate to `/sign-in`
 * (a public route in `apps/web/middleware.ts`).
 */
export async function signInProgrammatically(
  page: Page,
  opts: SignInProgrammaticallyOptions = {},
): Promise<void> {
  const env = assertE2EEnv();
  const identifier = opts.email ?? env.testUserEmail;

  await setupClerkTestingToken({ page });
  await page.goto('/sign-in');
  await clerk.signIn({
    page,
    signInParams: { strategy: 'email_code', identifier },
  });
}

export interface SignInThroughUIOptions {
  /**
   * Override the test email. MUST contain `+clerk_test` so the Clerk dev
   * instance accepts the fixed `424242` OTP code and suppresses real
   * email delivery. The user must also exist in Clerk — `+clerk_test`
   * suppresses email delivery but does NOT auto-create accounts. Defaults
   * to `E2E_CLERK_USER_EMAIL` from env, which `auth.setup.ts` provisions
   * via `createTestUser` before any unauthenticated spec runs.
   */
  email?: string;
  /**
   * URL predicate or string to wait for after the OTP is submitted.
   * Defaults to "any URL whose path does not start with /sign-in", which
   * covers the dashboard root, onboarding, and any other post-auth
   * landing target.
   */
  expectRedirectTo?: string | RegExp | ((url: URL) => boolean);
}

const CLERK_TEST_OTP_CODE = '424242';

/**
 * Drive Clerk's hosted `<SignIn />` UI end-to-end on a dev instance.
 *
 * Sequence:
 *   1. `setupClerkTestingToken({ page })` — primes the page with the
 *      bot-protection bypass token issued by `clerkSetup()` (so the
 *      hosted UI doesn't reject the run as automated).
 *   2. Navigate to `/sign-in`, which mounts `<SignIn />` from
 *      `@clerk/nextjs`.
 *   3. Fill the email field with a `+clerk_test@example.com` address;
 *      Clerk dev instances treat these as test identities — no real
 *      email is sent and the OTP is fixed.
 *   4. Type `424242` into the one-time-code field. Clerk renders OTP as
 *      either a single input or six per-digit inputs depending on
 *      version; both variants expose `autocomplete="one-time-code"` and
 *      both accept `pressSequentially` as a portable typing mechanism.
 *   5. Wait for navigation away from `/sign-in` (some variants
 *      auto-submit on the sixth digit; older ones require a button —
 *      waiting on the URL change is portable either way).
 *
 * This helper is intentionally the only place that exercises the real
 * Clerk UI. All other tests should rely on the shared `storageState`
 * produced by the setup project. See `.claude/specs/playwright-clerk-testing/design.md`.
 */
export async function signInThroughUI(
  page: Page,
  opts: SignInThroughUIOptions = {},
): Promise<void> {
  await setupClerkTestingToken({ page });

  const env = assertE2EEnv();
  const email = opts.email ?? env.testUserEmail;

  await page.goto('/sign-in');

  await page.getByRole('textbox', { name: /email/i }).fill(email);
  // Clerk's hosted UI also renders "Sign in with Google" — match the
  // primary "Continue" form button exactly to avoid a strict-mode collision.
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // Clerk's next step depends on the user's available factors. Users
  // created via Backend SDK with a password land on the password screen;
  // password-less users go straight to the OTP screen. Race the two
  // locators and follow whichever appears.
  const passwordInput = page.locator('input[type="password"]').first();
  const otpInput = page.locator('input[autocomplete="one-time-code"]').first();
  await Promise.race([
    passwordInput.waitFor({ state: 'visible', timeout: 15_000 }),
    otpInput.waitFor({ state: 'visible', timeout: 15_000 }),
  ]);

  if (await passwordInput.isVisible()) {
    await passwordInput.fill(env.testUserPassword);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    // After password, Clerk may also require a device-verification OTP
    // for new browser sessions ("You're signing in from a new device").
    // Wait for either the OTP screen to appear or for the post-sign-in
    // redirect to fire — whichever comes first.
    await Promise.race([
      otpInput.waitFor({ state: 'visible', timeout: 15_000 }),
      page.waitForURL(
        (url) => !url.pathname.startsWith('/sign-in'),
        { timeout: 15_000 },
      ),
    ]);
  }

  if (await otpInput.isVisible()) {
    await otpInput.pressSequentially(CLERK_TEST_OTP_CODE);
  }

  await page.waitForURL(
    opts.expectRedirectTo ?? ((url) => !url.pathname.startsWith('/sign-in')),
    { timeout: 15_000 },
  );
}
