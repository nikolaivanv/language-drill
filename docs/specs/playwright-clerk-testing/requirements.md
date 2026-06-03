# Requirements Document

## Introduction

Add browser-based end-to-end (E2E) testing infrastructure to `apps/web` using
Playwright. The current blocker is that **Clerk's bot protection on hosted
sign-in pages prevents any automated agent (Playwright, AI agents, scripted
browsers) from completing the login flow**, which means no E2E test can reach
any of the authenticated surfaces — and authenticated surfaces are
essentially the entire app (only `/sign-in`, `/sign-up`, and the Clerk
webhook are public, per `apps/web/middleware.ts`).

The feature ships **two complementary mechanisms** so that a developer or an
AI agent can write E2E tests against the real app, both locally and against
Vercel preview deploys:

1. **UI sign-in path** — uses the official `@clerk/testing` package, which
   issues a testing token via `setupClerkTestingToken()` that disables bot
   protection on Clerk dev instances, combined with Clerk's reserved
   `+clerk_test@example.com` email pattern and the fixed verification code
   `424242`. Reserved for smoke tests that explicitly need to exercise the
   real sign-in UI.
2. **Programmatic sign-in path** — a Playwright `globalSetup` that uses the
   Clerk Backend SDK to create a session for a pre-seeded user, persists the
   storage state to disk, and is reused by every other test so the suite
   starts already authenticated. The default test user reuses the same
   `dev_user_001` ID that the local Lambda dev server (`infra/lambda/src/dev.ts`)
   already injects, keeping local app state coherent across the API and web
   sides.

A successful delivery also includes:

- Playwright config wired into the existing pnpm workspaces / Turborepo setup
- One sample test per mechanism plus shared helper utilities
- Updates to `.env.example` documenting the new variables
- Documentation in `CLAUDE.md` (or a new `docs/testing.md` referenced from
  `CLAUDE.md`) so future AI agents pick the right approach without
  re-discovering it

## Alignment with Product Vision

The product steering documents (`docs/architecture.md`, `.claude/steering/product.md`)
emphasize that Language Drill is portfolio-quality software with a tight
serverless feedback loop. Two specific product/tech goals are served:

- **Quality at portfolio bar.** The CI/CD section of `CLAUDE.md` already
  enforces lint + typecheck + Vitest as pre-push gates. The current gap is
  any verification that the user-visible flows actually work end-to-end
  after a deploy. Playwright fills that gap without changing the
  serverless-first deployment model.
- **AI-agent-first development workflow.** This project is heavily worked
  on by AI coding agents (see `CLAUDE.md`, the spec-driven workflow, the
  rich skill set in `.claude/skills/`). Removing the Clerk auth wall for
  agents directly supports the project's documented development model —
  agents can verify their own UI changes instead of asking the human to
  click through the app.

This feature is also a natural extension of the existing local dev pattern
(`DEV_USER_ID=dev_user_001` in `infra/lambda/src/dev.ts`): it gives the web
side the same "skip Clerk for trusted contexts" affordance the Lambda API
already has, but scoped strictly to test runners and never to production.

## Requirements

### Requirement 1 — Programmatic sign-in via Playwright globalSetup

**User Story:** As an AI agent or developer running the E2E suite, I want
tests to start already authenticated as a known test user, so that I can
write and run UI tests against authenticated routes without going through
Clerk's sign-in UI every time.

#### Acceptance Criteria

1. WHEN the Playwright suite starts THEN the `globalSetup` SHALL create (or
   reuse) a Clerk session for the configured test user and write the
   browser storage state to a known on-disk path (e.g.
   `apps/web/e2e/.auth/storage-state.json`).
2. WHEN any individual test loads THEN the Playwright project config SHALL
   apply that storage state by default, so navigating to any protected
   route (e.g. `/`, `/practice`, `/progress`) SHALL render the
   authenticated UI without redirecting to `/sign-in`.
3. WHEN the test user does not yet exist in Clerk THEN the `globalSetup`
   SHALL create the user via the Clerk Backend SDK using a deterministic
   email (e.g. `test+e2e@langdrill.app` or
   `e2e_user+clerk_test@example.com`), and SHALL also upsert a matching
   row into the Postgres `users` table so foreign-key constraints on
   `user_exercise_history` / `usage_events` are satisfied.
4. IF the environment variables `CLERK_SECRET_KEY` and `DATABASE_URL` are
   not present THEN `globalSetup` SHALL fail fast with a clear error
   message naming the missing variable, and SHALL NOT attempt to run any
   spec.
5. WHEN `globalSetup` runs against a dev Clerk instance (publishable key
   starts with `pk_test_`) THEN it SHALL proceed; WHEN it runs against a
   production instance (`pk_live_`) THEN it SHALL refuse to execute and
   exit with a non-zero code, preventing accidental writes to the real
   user table.
6. WHEN the suite finishes THEN the storage state file MAY be retained for
   re-use across runs (faster iteration).
7. WHEN a persisted storage state file exists at the start of a run THEN
   `globalSetup` SHALL check the session for expiry (locally cached
   expiry timestamp or a lightweight Clerk Backend API verify) and SHALL
   refresh it before any spec runs if it is missing, expired, or within
   a configurable buffer window (default 5 minutes).

### Requirement 2 — UI sign-in path with `@clerk/testing`

**User Story:** As a developer maintaining the sign-in surface, I want at
least one E2E test that exercises the real Clerk-hosted sign-in UI, so
that visual or behavioral regressions in the sign-in flow are caught
before they reach production.

#### Acceptance Criteria

1. WHEN a test in the `unauthenticated` Playwright project executes
   THEN the test SHALL call `setupClerkTestingToken({ page })` from
   `@clerk/testing/playwright` before navigating, which sets the
   bot-protection bypass token on the Clerk dev instance.
2. WHEN the test types the test email into the Clerk sign-in form THEN
   the email SHALL use the reserved `+clerk_test@example.com` pattern
   (e.g. `e2e_smoke+clerk_test@example.com`) so Clerk skips actual email
   delivery on dev instances.
3. WHEN the test enters the OTP verification code THEN the code SHALL be
   the fixed `424242` value documented by Clerk for testing.
4. WHEN sign-in completes THEN the test SHALL assert that the browser
   navigates away from `/sign-in` and a known authenticated element is
   visible on the destination route.
5. WHEN the UI sign-in test runs THEN it SHALL execute in a Playwright
   project that does **not** load the shared storage state (each run
   signs in from a clean session), so the act of signing in is itself
   under test.
6. IF the Clerk publishable key is `pk_live_` THEN the UI sign-in test
   SHALL skip (mark itself as skipped with a clear reason) rather than
   attempt to use the test-email/test-OTP pattern, which only works on
   dev instances.

### Requirement 3 — Playwright project configuration and reusable helpers

**User Story:** As a developer adding a new E2E test, I want a single
documented helper for "sign in as the default test user" and a single
documented helper for "sign in as a fresh user via the UI", so that I
don't have to re-derive the patterns each time.

#### Acceptance Criteria

1. WHEN the repo is checked out fresh THEN running
   `pnpm --filter @language-drill/web exec playwright install` SHALL
   install browsers, and `pnpm --filter @language-drill/web test:e2e`
   SHALL run the full E2E suite end-to-end.
2. WHEN a developer reads `apps/web/playwright.config.ts` THEN they SHALL
   find at least two Playwright projects: `authenticated` (uses the
   shared storage state from globalSetup) and `unauthenticated` (no
   storage state, used by the UI sign-in test).
3. WHEN a developer reads `apps/web/e2e/helpers/auth.ts` THEN they SHALL
   find a typed `signInThroughUI(page, options?)` helper that wraps the
   `@clerk/testing` setup and the OTP flow, and a typed
   `createTestUser(options)` helper that wraps the Clerk Backend SDK call
   plus the Postgres upsert.
4. WHEN the suite runs against `http://localhost:3000` THEN the
   `playwright.config.ts` SHALL auto-start the web dev server via the
   `webServer` option (or document why it doesn't, e.g. when running
   against a pre-deployed preview URL).
5. WHEN the suite runs against a Vercel preview URL THEN the developer
   SHALL be able to override the base URL via an environment variable
   (e.g. `PLAYWRIGHT_BASE_URL`), and the config SHALL skip the
   `webServer` auto-start in that mode.
6. WHEN the default test user is provisioned by either helper THEN its
   stable identifier SHALL match the local Lambda dev convention
   (`DEV_USER_ID=dev_user_001` from `infra/lambda/src/dev.ts`), so the
   web suite and the Lambda dev server share the same DB row and
   downstream tests can rely on consistent state.

### Requirement 4 — Environment variables and CI hygiene

**User Story:** As a developer setting up the E2E suite for the first
time, I want a documented list of required environment variables, so I
can run the suite locally and in CI without trial-and-error.

#### Acceptance Criteria

1. WHEN `apps/web/.env.example` is read THEN it SHALL list every new
   variable introduced by this feature, with a short comment explaining
   its purpose and a note about whether it is required, optional, or
   CI-only.
2. WHEN any variable contains a secret (e.g. `CLERK_SECRET_KEY`,
   `DATABASE_URL`) THEN the example file SHALL show a placeholder, not a
   real value, and the documentation SHALL warn against committing real
   values.
3. IF an E2E run is invoked in CI without the required secrets THEN the
   run SHALL fail with an explicit error identifying the missing
   variables (no silent skipping that hides broken setup).

### Requirement 5 — Documentation for future AI agents

**User Story:** As an AI agent picking up a future task that involves
adding or modifying E2E coverage, I want clear written guidance on which
mechanism to use, so I don't waste tokens re-discovering the Clerk
testing patterns.

#### Acceptance Criteria

1. WHEN this feature ships THEN there SHALL be a single canonical
   testing-guidance document — either a new section added to
   `CLAUDE.md` or a new file at `docs/testing.md` linked from
   `CLAUDE.md`.
2. WHEN that document is read THEN it SHALL state the default rule:
   "Use the authenticated project (programmatic sign-in) for all
   feature tests; use the unauthenticated project (UI sign-in) only when
   the sign-in surface itself is under test."
3. WHEN that document is read THEN it SHALL document the two helpers
   (`signInThroughUI`, `createTestUser`), the test-user convention
   (`dev_user_001` reused from local dev), the reserved Clerk test email
   pattern (`+clerk_test@example.com`), and the fixed OTP code
   (`424242`).
4. WHEN that document is read THEN it SHALL include the commands needed
   to run the suite locally, against a preview deploy, and how to
   refresh storage state if a session expires.
5. WHEN that document is read THEN it SHALL link to the relevant Clerk
   docs (`https://clerk.com/docs/testing/playwright/overview`) so the
   reader can follow upstream changes.

### Requirement 6 — Sample tests prove the mechanisms work

**User Story:** As a reviewer of this PR, I want at least one sample
test per mechanism that runs green in CI (or locally with the right env
vars), so I can verify the infrastructure actually works.

#### Acceptance Criteria

1. WHEN the suite runs THEN there SHALL be at least one test under the
   `authenticated` project that loads `/` (or another protected route)
   and asserts that an authenticated-only element is visible without any
   sign-in interaction.
2. WHEN the suite runs THEN there SHALL be at least one test under the
   `unauthenticated` project that signs in through the Clerk UI using
   the test-email/test-OTP pattern and asserts the post-sign-in landing
   surface.
3. WHEN either sample test fails for the first time THEN the failure
   output SHALL include a screenshot at the moment of failure and a
   full Playwright trace, written under a stable artifact directory
   (e.g. `apps/web/playwright-report/`). The Playwright config SHALL
   set `trace: 'retain-on-failure'` (or equivalent) so traces are
   never produced for passing tests.

## Non-Functional Requirements

### Performance
- The full E2E suite (sample tests only at this stage) SHALL complete in
  under 90 seconds locally on a developer laptop, excluding the one-time
  cost of `playwright install`.
- `globalSetup` SHALL reuse a persisted storage state when present and
  unexpired, so steady-state suite runs SHALL NOT pay the cost of a
  Clerk Backend API call on every invocation.

### Security
- The Clerk secret key, database URL, and any other credentials SHALL
  only be loaded from environment variables (never committed).
- The programmatic sign-in mechanism SHALL refuse to run against a
  production Clerk instance (publishable key starts with `pk_live_`).
- The test user's database row SHALL be created with the same FK
  constraints as a real user and SHALL NOT bypass the schema.
- No new HTTP endpoints SHALL be added to the web app to support tests
  (in particular, no dev-mode auth bypass route in production code).

### Reliability
- A failed `globalSetup` SHALL produce an actionable error message that
  names the failing step (Clerk API call, DB upsert, file write) and the
  offending env var when relevant.
- Stale or expired storage state SHALL be detected and refreshed
  automatically, not surface as a confusing mid-test redirect to
  `/sign-in`.

### Usability
- The same single command (`pnpm test:e2e` from repo root, or
  equivalent) SHALL run the suite locally and in CI.
- The documentation entry point SHALL be discoverable from `CLAUDE.md`
  in under 30 seconds of reading.
- Helper APIs SHALL be typed (TypeScript) and exported from a single
  module so IDE auto-import works without further configuration.
