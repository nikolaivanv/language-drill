# End-to-end testing (Playwright + Clerk)

The Playwright suite lives in `apps/web/e2e/` and exercises the real Next.js
app against a `pk_test_` Clerk dev instance and the dev Neon branch. It is
the only E2E layer in the repo; Vitest (`pnpm test`) remains the default
unit-test runner and is unaffected.

Upstream reference: <https://clerk.com/docs/testing/playwright/overview>.

## Default rule

Use the **`authenticated` project** for every new feature test — tests start
already signed in via the shared `storageState` produced by `auth.setup.ts`,
so there is no sign-in interaction in the test body. Only reach for the
**`unauthenticated` project** when the sign-in surface itself is the thing
under test (e.g. a regression against the Clerk-hosted UI).

## Helpers

Exported from `apps/web/e2e/helpers/auth.ts`:

```ts
createTestUser(opts?: {
  email?: string;
  password?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ userId: string; email: string; created: boolean }>;
```
Idempotently provision the canonical E2E identity in Clerk + Postgres
(`users` row). Used by the setup project; safe to call repeatedly.

```ts
signInProgrammatically(
  page: Page,
  opts?: { email?: string },
): Promise<void>;
```
Server-token sign-in via `@clerk/testing/playwright`'s `clerk.signIn`.
Bypasses MFA, OTP, and bot protection. Used by the setup project to mint
storage state — not from individual specs.

```ts
signInThroughUI(
  page: Page,
  opts?: {
    email?: string;
    expectRedirectTo?: string | RegExp | ((url: URL) => boolean);
  },
): Promise<void>;
```
Drives Clerk's hosted `<SignIn />` end-to-end using the reserved test-email
pattern + fixed OTP. The only helper that exercises the real UI; reserve
for `unauthenticated` smoke tests.

## Reserved test patterns

Clerk dev instances treat email addresses containing `+clerk_test` as test
identities — no real email is sent and the OTP is fixed at `424242`. Both
patterns are **dev-instance only**: they do nothing on `pk_live_` keys, and
`assertE2EEnv()` refuses to start the suite against a production instance.

| Pattern | Where it appears | Effect |
|---|---|---|
| `…+clerk_test@example.com` | `E2E_CLERK_USER_EMAIL`, `signInThroughUI` default | Suppresses email delivery on the Clerk dev instance |
| `424242` | OTP field in Clerk hosted UI | Fixed code accepted by Clerk dev for any test address |

## Test-user alignment with the Lambda dev API

`auth.setup.ts` writes `apps/web/e2e/.auth/test-user.json` containing the
Clerk-issued user ID. To make the local Lambda dev API act as the same
user (so the API row, FK constraints, and exercise history all line up
with what the web app sees), pipe the manifest's `userId` into
`DEV_USER_ID` when starting the API:

```bash
DEV_USER_ID=$(jq -r .userId apps/web/e2e/.auth/test-user.json) pnpm dev:api
```

Without the override the dev API still upserts `dev_user_001` and the web
app will see a different identity than what the E2E suite provisioned.

## Commands

All commands run from the repo root unless noted.

```bash
# One-time: download Playwright's browser binaries
pnpm --filter @language-drill/web test:e2e:install

# Run the full suite locally (spawns next dev on :3000)
pnpm --filter @language-drill/web test:e2e

# Interactive UI / time-travel debugger
pnpm --filter @language-drill/web test:e2e:ui

# Run against a Vercel preview deploy (no local server)
PLAYWRIGHT_BASE_URL=https://your-preview.vercel.app \
  pnpm --filter @language-drill/web test:e2e

# Force a fresh sign-in (e.g. session expired, schema changed)
rm apps/web/e2e/.auth/storage-state.json && \
  pnpm --filter @language-drill/web test:e2e
```

## Env vars

Mirrors the `apps/web/.env.example` block. The suite calls `assertE2EEnv()`
before touching Clerk or the DB, so any missing required var fails fast
with `E2E missing env: <NAME>`.

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | Must start with `pk_test_`. `pk_live_` is rejected outright. |
| `CLERK_SECRET_KEY` | yes | Matching `sk_test_…` from the same dev instance. |
| `DATABASE_URL` | yes | Dev Neon branch locally; per-PR ephemeral branch in CI. |
| `E2E_CLERK_USER_EMAIL` | yes | Must contain `+clerk_test`. |
| `E2E_CLERK_USER_PASSWORD` | yes | Server-controlled; never delivered. |
| `PLAYWRIGHT_BASE_URL` | no | Default `http://localhost:3000`. When set, Playwright skips its own dev server. |
| `E2E_STORAGE_STATE_TTL_MINUTES` | no | Default 30. Storage state older than this triggers a fresh sign-in. |

## CI

The `e2e` job in `.github/workflows/ci.yml` runs the suite on every PR. It
needs `lint-typecheck` + `test` to pass, then `neon-migrate` (it reuses that
job's migrated per-PR Neon branch via the `database_url` job output, where
`auth.setup` upserts the test user). It runs in parallel with the Vercel
preview deploy.

It does **not** target the preview URL: the web specs mock every API call with
`page.route`, so they only need the frontend served (Playwright starts
`next dev` itself when `PLAYWRIGHT_BASE_URL` is unset) plus a dev Clerk session
— no live Lambda API. The full-stack drill/theory smoke tests in
`mobile-responsive.spec.ts` are gated on `E2E_FULL_STACK` (unset in CI) and
**skip**; run them against a preview deploy or local full stack when needed.

The four Clerk vars come from GitHub Actions secrets that must point at the
**dev** Clerk instance (`pk_test_`/`sk_test_` — the suite refuses `pk_live_`):

| GitHub secret | Maps to env var |
|---|---|
| `E2E_CLERK_PUBLISHABLE_KEY` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` |
| `E2E_CLERK_SECRET_KEY` | `CLERK_SECRET_KEY` |
| `E2E_CLERK_USER_EMAIL` | `E2E_CLERK_USER_EMAIL` (must contain `+clerk_test`) |
| `E2E_CLERK_USER_PASSWORD` | `E2E_CLERK_USER_PASSWORD` |

`DATABASE_URL` is the `neon-migrate` branch; `NEON_API_KEY` / `NEON_PROJECT_ID`
are already configured. Until these four secrets exist, the `e2e` job fails
fast with `E2E missing env: <NAME>`.
