// Centralized env-var validation for the Playwright E2E suite.
//
// This module is the single guardrail between `process.env` and the rest of
// `apps/web/e2e/**`. Every other helper, the setup project, and the
// playwright config call `assertE2EEnv()` before touching Clerk or the DB.
//
// Two safety properties are enforced here:
//   - missing required env vars fail fast with a precise `E2E missing env: X`
//     error, so a misconfigured run never silently proceeds against the
//     wrong instance;
//   - a `pk_live_` publishable key is rejected outright, mirroring the
//     production-instance refusal documented in the spec
//     (.claude/specs/playwright-clerk-testing/requirements.md, R1.AC5 /
//     R2.AC6) and matching the corresponding security NFR.
//
// Dotenv loading is intentionally NOT done here — the entry point
// (playwright.config.ts) is responsible for loading `.env` before invoking
// any code that reads `process.env`. Keeping env.ts pure means it can be
// imported from unit tests or scripts without side effects.

export interface E2EEnv {
  /** Clerk Backend SDK secret key (`sk_test_…`). Required. */
  clerkSecretKey: string;
  /** Publishable key (`pk_test_…`). MUST start with `pk_test_`. */
  clerkPublishableKey: string;
  /** Postgres connection string used to upsert the test-user row. */
  databaseUrl: string;
  /** Base URL the suite navigates against — local dev or a preview deploy. */
  baseUrl: string;
  /** Canonical E2E test-user email; MUST contain `+clerk_test` to suppress real email delivery. */
  testUserEmail: string;
  /**
   * Password assigned to the test user at provisioning time. The
   * email-only `clerk.signIn` strategy used at runtime does not need it;
   * it is still required so initial provisioning via the Clerk Backend
   * SDK is deterministic and re-runnable.
   */
  testUserPassword: string;
  /** Storage-state freshness window before re-signing. Default 30 minutes. */
  storageStateTtlMinutes: number;
}

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_STORAGE_STATE_TTL_MINUTES = 30;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`E2E missing env: ${name}`);
  }
  return value;
}

function parseTtlMinutes(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_STORAGE_STATE_TTL_MINUTES;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `E2E invalid env: E2E_STORAGE_STATE_TTL_MINUTES must be a positive integer (got "${raw}")`,
    );
  }
  return parsed;
}

export function assertE2EEnv(): E2EEnv {
  const clerkPublishableKey = requireEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');

  if (clerkPublishableKey.startsWith('pk_live_')) {
    throw new Error(
      'E2E refuses to run against a production Clerk instance. ' +
        'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must start with pk_test_.',
    );
  }
  if (!clerkPublishableKey.startsWith('pk_test_')) {
    throw new Error(
      `E2E invalid env: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must start with pk_test_ (got "${clerkPublishableKey.slice(0, 8)}…")`,
    );
  }

  const env: E2EEnv = {
    clerkSecretKey: requireEnv('CLERK_SECRET_KEY'),
    clerkPublishableKey,
    databaseUrl: requireEnv('DATABASE_URL'),
    baseUrl: process.env['PLAYWRIGHT_BASE_URL']?.trim() || DEFAULT_BASE_URL,
    testUserEmail: requireEnv('E2E_CLERK_USER_EMAIL'),
    testUserPassword: requireEnv('E2E_CLERK_USER_PASSWORD'),
    storageStateTtlMinutes: parseTtlMinutes(process.env['E2E_STORAGE_STATE_TTL_MINUTES']),
  };

  return Object.freeze(env);
}
