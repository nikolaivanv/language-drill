# Implementation Plan

## Task Overview

Add Playwright E2E infrastructure to `apps/web` in small, mostly-independent
steps. The ordering builds bottom-up: install deps → helpers (env, manifest,
auth) → setup project → Playwright config → npm/turbo scripts → sample
tests → env-example → agent-facing docs. Each task touches 1–3 files and is
verifiable on its own (compile, lint, or — for the last few — a green test
run).

## Steering Document Compliance

- File layout matches existing `apps/web` conventions: production code under
  `app/`, `components/`, `lib/`; E2E gets its own `e2e/` root (parallel to
  Vitest's existing in-repo placement) so Playwright's discovery doesn't
  collide with `*.test.tsx` files.
- All new code is TypeScript with strict typing, per the repo standard.
- New scripts wire into pnpm-workspace + Turborepo using the existing
  `@language-drill/web#...` task naming.
- No production middleware or HTTP-route changes — auth gate stays exactly
  as `apps/web/middleware.ts` defines it today.

## Atomic Task Requirements

**Each task must meet these criteria for optimal agent execution:**
- **File Scope**: Touches 1-3 related files maximum
- **Time Boxing**: Completable in 15-30 minutes
- **Single Purpose**: One testable outcome per task
- **Specific Files**: Must specify exact files to create/modify
- **Agent-Friendly**: Clear input/output with minimal context switching

## Task Format Guidelines
- Use checkbox format: `- [ ] Task number. Task description`
- **Specify files**: Always include exact file paths to create/modify
- **Include implementation details** as bullet points
- Reference requirements using: `_Requirements: X.Y, Z.A_`
- Reference existing code to leverage using: `_Leverage: path/to/file.ts_`
- Focus only on coding tasks (no deployment, user testing, etc.)

## Tasks

- [x] 1. Install Playwright + Clerk testing dev dependencies in `apps/web/package.json`
  - File: `apps/web/package.json`
  - Add to `devDependencies`: `@playwright/test` (^1.49.x), `@clerk/testing` (^1.x), `@clerk/backend` (matching `infra/lambda/package.json` ^3.4.7), `drizzle-orm` (matching `packages/db` version), `dotenv` (for local env loading in the setup script). Use the latest stable versions per the repo's package-management rule in `CLAUDE.md`.
  - Add `"@language-drill/db": "workspace:*"` to `dependencies` if not already present (it isn't today — only `@language-drill/api-client` and `@language-drill/shared` are listed).
  - Run `pnpm install` from repo root to update the lockfile; confirm no peer-dep warnings.
  - Purpose: Make `@playwright/test`, `@clerk/testing`, `@clerk/backend`, and the Drizzle client available to `apps/web/e2e/**`.
  - _Leverage: infra/lambda/package.json (Clerk backend version), packages/db/package.json (drizzle version)_
  - _Requirements: 3.1_

- [x] 2. Add `.gitignore` for E2E auth artifacts
  - File: `apps/web/e2e/.gitignore` (create)
  - Single-purpose file ignoring the `.auth/` directory and `playwright-report/`.
  - Body:
    ```
    .auth/
    playwright-report/
    test-results/
    ```
  - Also append `apps/web/playwright-report/` and `apps/web/test-results/` to the root `.gitignore` if not already covered by `dist/`/`.next/` rules — they aren't today.
  - Purpose: Prevent committing storage state, test-user manifests, and HTML/trace reports.
  - _Requirements: 4.1, 4.2_

- [x] 3. Create `helpers/env.ts` with `assertE2EEnv()` and the `pk_live_` guard
  - File: `apps/web/e2e/helpers/env.ts` (create)
  - Export `E2EEnv` interface and `assertE2EEnv()` per the design Components and Interfaces / Component 3 section.
  - Read these env vars from `process.env`: `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `DATABASE_URL`, `PLAYWRIGHT_BASE_URL` (default `http://localhost:3000`), `E2E_CLERK_USER_EMAIL`, `E2E_CLERK_USER_PASSWORD`, `E2E_STORAGE_STATE_TTL_MINUTES` (parsed, default 30).
  - Throw `Error("E2E missing env: <NAME>")` for each missing required var (one missing var per error message is fine; first-missing-wins is OK).
  - Throw an error with the documented message when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` starts with `pk_live_`.
  - Freeze the returned object with `Object.freeze`.
  - Purpose: Single source of truth for env validation and the production-instance guard.
  - _Requirements: 1.4, 1.5, 2.6, 4.3, 4.NFR-Security_

- [x] 4. Create `helpers/test-user.ts` with constants and manifest IO
  - File: `apps/web/e2e/helpers/test-user.ts` (create)
  - Export `DEFAULT_E2E_USER_EMAIL = 'e2e+clerk_test@example.com'`, `STORAGE_STATE_PATH` (absolute path resolved from `__dirname`), `TEST_USER_MANIFEST_PATH` (likewise).
  - Export `TestUserManifest` interface and async functions `writeTestUserManifest(m)` / `readTestUserManifest()` using `fs/promises`.
  - Add `isStorageStateFresh(ttlMinutes: number): Promise<boolean>` that returns true iff `STORAGE_STATE_PATH` exists, parses as JSON with `cookies` and `origins` arrays, and was mtime'd within `ttlMinutes` of `Date.now()`. Returns false otherwise (missing, malformed, stale).
  - Ensure the `.auth/` directory is created before any write (`mkdir({ recursive: true })`).
  - Purpose: Keep storage-state and manifest file conventions in one module.
  - _Leverage: Node fs/promises, path_
  - _Requirements: 1.1, 1.6, 1.7, 3.6_

- [x] 5. Add `createTestUser()` to `helpers/auth.ts`
  - File: `apps/web/e2e/helpers/auth.ts` (create)
  - Implement `createTestUser(opts?)` per the design / Component 4 contract.
  - Use `@clerk/backend`'s `createClerkClient({ secretKey })` factory; do not import from `@clerk/nextjs` (server runtime).
  - Behavior: list users by `emailAddress: [email]`; if empty, create with `skipPasswordChecks: true`, `publicMetadata: { e2eTestUser: true, ...opts?.metadata }`; upsert `db.insert(users).values({ id: clerkUser.id, email }).onConflictDoNothing()` using `@language-drill/db`'s exported `users` table and Drizzle client.
  - Return `{ userId, email, created }`.
  - Purpose: Idempotent provisioning of the canonical E2E identity in Clerk + Postgres.
  - _Leverage: infra/lambda/src/dev.ts (upsert pattern), packages/db barrel (users table), helpers/env.ts, helpers/test-user.ts_
  - _Requirements: 1.3, 3.3, 4.NFR-Security_

- [x] 6. Add `signInProgrammatically()` to `helpers/auth.ts`
  - File: `apps/web/e2e/helpers/auth.ts` (continue from task 5)
  - Implement `signInProgrammatically(page, opts?)` per the design.
  - Body is essentially `await clerk.signIn({ page, emailAddress: opts?.email ?? assertE2EEnv().testUserEmail })` — the email-address strategy creates a server-side token and bypasses verification.
  - Before calling `clerk.signIn`, ensure `clerkSetup()` has run (it's expected to have been called by `auth.setup.ts` earlier in the same setup project, but assert presence of the testing token via a safe re-call — `clerkSetup` is idempotent).
  - Import `clerk` and `clerkSetup` from `@clerk/testing/playwright`.
  - Purpose: Reusable programmatic sign-in used by the setup project.
  - _Leverage: @clerk/testing/playwright_
  - _Requirements: 1.2_

- [x] 7. Add `signInThroughUI()` to `helpers/auth.ts`
  - File: `apps/web/e2e/helpers/auth.ts` (continue from task 6)
  - Implement `signInThroughUI(page, opts?)` per the design.
  - Steps: `await setupClerkTestingToken({ page })`; `await page.goto('/sign-in')`; fill the email field with `opts?.email ?? 'e2e_smoke+clerk_test@example.com'`; submit; on the OTP screen enter `424242`; submit; `await page.waitForURL(opts?.expectRedirectTo ?? (url) => !url.pathname.startsWith('/sign-in'), { timeout: 15_000 })`.
  - Use Clerk's recommended `getByRole`-based selectors where possible to stay resilient to component re-skinning.
  - Purpose: One reusable helper for any future smoke test that exercises Clerk's hosted sign-in UI.
  - _Leverage: @clerk/testing/playwright (setupClerkTestingToken), Playwright getByRole_
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 8. Create the Playwright setup project entry `auth.setup.ts`
  - File: `apps/web/e2e/auth.setup.ts` (create)
  - Body: import `test as setup` from `@playwright/test`; one `setup('authenticate', async ({ page }) => { ... })` block:
    1. `const env = assertE2EEnv();`
    2. If `await isStorageStateFresh(env.storageStateTtlMinutes)` and the manifest already exists, log "Reusing cached storage state" and return.
    3. `await clerkSetup();`
    4. `const { userId, email, created } = await createTestUser();`
    5. `await signInProgrammatically(page);`
    6. `await page.context().storageState({ path: STORAGE_STATE_PATH });`
    7. `await writeTestUserManifest({ userId, email, createdAt: new Date().toISOString() });`
  - Wrap the whole block in try/catch only to re-throw with context-tagged messages (e.g., prepend "[auth.setup] ").
  - Purpose: One-shot setup that produces the storageState consumed by the `authenticated` project.
  - _Leverage: helpers/env.ts, helpers/auth.ts, helpers/test-user.ts, @clerk/testing/playwright_
  - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7_

- [x] 9. Create `playwright.config.ts` at `apps/web/playwright.config.ts`
  - File: `apps/web/playwright.config.ts` (create)
  - Use `defineConfig` from `@playwright/test`.
  - Set `testDir: './e2e/tests'`, `outputDir: './test-results'`, `reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }]]`, `use.baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'`, `use.trace: 'retain-on-failure'`, `use.screenshot: 'only-on-failure'`.
  - Define three projects exactly per design Component 1's table: `setup` (matches `auth.setup.ts`), `authenticated` (dependencies: ['setup'], `storageState: STORAGE_STATE_PATH`, `testDir: './e2e/tests/authenticated'`), `unauthenticated` (no storageState, `testDir: './e2e/tests/unauthenticated'`).
  - `webServer` is set only when `process.env.PLAYWRIGHT_BASE_URL` is unset: command `pnpm --filter @language-drill/web dev`, url `http://localhost:3000`, `reuseExistingServer: !process.env.CI`, `timeout: 120_000`.
  - Import `STORAGE_STATE_PATH` from `./e2e/helpers/test-user`.
  - Purpose: Single Playwright config that supports local, preview-URL, and CI modes.
  - _Leverage: @playwright/test, helpers/test-user.ts_
  - _Requirements: 3.2, 3.4, 3.5, 6.3_

- [x] 10. Add `test:e2e` scripts to `apps/web/package.json`
  - File: `apps/web/package.json` (modify)
  - Add to `scripts`:
    ```
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:install": "playwright install --with-deps chromium"
    ```
  - Do not modify the existing `test` script — Vitest stays the default unit-test runner.
  - Purpose: One-line entry point for the E2E suite from inside `apps/web/`.
  - _Requirements: 3.1, NFR-Usability_

- [x] 11. Register the `test:e2e` task in `turbo.json`
  - File: `turbo.json` (modify)
  - Add a `@language-drill/web#test:e2e` task entry: `{ "cache": false, "persistent": false, "dependsOn": ["^build"] }`. Caching off because the run is side-effectful (Clerk API + DB).
  - Purpose: Allow `pnpm turbo run test:e2e` from repo root if desired, and keep Turbo aware of the task graph.
  - _Leverage: turbo.json existing @language-drill/web entries_
  - _Requirements: 3.1_

- [x] 12. Append E2E env vars to `apps/web/.env.example`
  - File: `apps/web/.env.example` (modify)
  - Append the block from design Component 9 verbatim, with placeholders only (no real secrets).
  - Include comments explaining the `+clerk_test` requirement, the `pk_test_`-only constraint, the optional `PLAYWRIGHT_BASE_URL` override, and the optional `E2E_STORAGE_STATE_TTL_MINUTES`.
  - Purpose: Document every new env variable in the one place developers look.
  - _Requirements: 4.1, 4.2_

- [x] 13. Add sample authenticated test `dashboard.spec.ts`
  - File: `apps/web/e2e/tests/authenticated/dashboard.spec.ts` (create)
  - Body: import `test, expect` from `@playwright/test`. One test "renders authenticated landing page": `await page.goto('/')`; `await expect(page).not.toHaveURL(/\/sign-in/);` and one positive assertion against a stable element on the dashboard root — pick the first `<h1>` / `[data-testid]` / known nav text from `apps/web/app/(dashboard)/page.tsx` while implementing (read the file at task time).
  - No sign-in interaction in this spec — it relies entirely on the `storageState` from setup.
  - Purpose: Sample that proves the authenticated project reuses storage state.
  - _Leverage: apps/web/app/(dashboard)/page.tsx_
  - _Requirements: 6.1_

- [x] 14. Add sample UI sign-in test `sign-in.spec.ts`
  - File: `apps/web/e2e/tests/unauthenticated/sign-in.spec.ts` (create)
  - Body: import `test, expect` from `@playwright/test` and the env helper. `test.skip(env.clerkPublishableKey.startsWith('pk_live_'), 'UI sign-in test only runs against pk_test_ Clerk instances.');` One test "signs in via Clerk-hosted UI": call `signInThroughUI(page)`; `await expect(page).not.toHaveURL(/\/sign-in/);`; assert one element from the post-sign-in route.
  - Purpose: Sample that proves the unauthenticated project + `setupClerkTestingToken` + reserved test email + `424242` OTP works end-to-end.
  - _Leverage: helpers/auth.ts, helpers/env.ts_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 6.2_

- [x] 15. Create the agent-facing testing doc `docs/testing.md`
  - File: `docs/testing.md` (create)
  - Sections (short and dense):
    1. **Default rule** — one paragraph: "Use the `authenticated` project for feature tests; use the `unauthenticated` project only when the sign-in UI itself is under test."
    2. **Helpers** — code-fenced signatures of `createTestUser`, `signInProgrammatically`, `signInThroughUI` plus one-line descriptions.
    3. **Reserved test patterns** — note `+clerk_test@example.com` email pattern and fixed OTP `424242`; that these only work against `pk_test_` instances.
    4. **Test-user alignment with Lambda dev** — the `DEV_USER_ID=$(jq -r .userId apps/web/e2e/.auth/test-user.json) pnpm dev:api` recipe.
    5. **Commands** — local run, UI mode, preview-URL run, refresh storage state (`rm apps/web/e2e/.auth/storage-state.json && pnpm --filter @language-drill/web test:e2e`).
    6. **Env vars** — table mirroring `.env.example` block.
    7. **CI** — one paragraph: which secrets are needed; that DATABASE_URL comes from the Neon ephemeral branch step.
    8. **Upstream link** — `https://clerk.com/docs/testing/playwright/overview`.
  - Purpose: Single canonical reference so future AI agents pick the right approach without re-discovering it.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 16. Reference `docs/testing.md` from `CLAUDE.md`
  - File: `CLAUDE.md` (modify)
  - Insert a new short subsection under the existing "## Testing" heading (the section that currently covers Vitest task-by-task expectations). Add:
    ```
    ### End-to-end (Playwright)

    The E2E suite lives in `apps/web/e2e/` and runs via
    `pnpm --filter @language-drill/web test:e2e`. Default project is
    `authenticated` (tests start already signed in via the shared
    storageState produced by `auth.setup.ts`); only smoke tests that
    exercise the Clerk-hosted sign-in surface should use the
    `unauthenticated` project. Full guide: `docs/testing.md`.
    ```
  - Do not touch the existing Vitest paragraph above it.
  - Purpose: Discoverability — agents skimming `CLAUDE.md` find the testing doc in under 30 seconds.
  - _Leverage: CLAUDE.md existing "## Testing" section_
  - _Requirements: 5.1, NFR-Usability_

- [x] 17. Add a short orientation README at `apps/web/e2e/README.md`
  - File: `apps/web/e2e/README.md` (create)
  - 10–20 lines max: one-line purpose, link to `docs/testing.md`, the `pnpm --filter @language-drill/web test:e2e:install` and `test:e2e` commands, and a note that `.auth/` is gitignored.
  - Purpose: Help a developer who lands in `apps/web/e2e/` from a code search rather than the project root.
  - _Requirements: 5.4, NFR-Usability_

- [x] 18. Verify the full flow runs green locally
  - Files: none (verification only — does not satisfy the "coding tasks only" rule but is the only way to close out R6, so it's included as the final step; if running locally is not feasible at execution time, the executing agent should run `pnpm --filter @language-drill/web typecheck` and `pnpm --filter @language-drill/web lint` in lieu of the test run and document the gap).
  - Run from repo root: `pnpm install`, then `pnpm --filter @language-drill/web exec playwright install --with-deps chromium`, then `pnpm --filter @language-drill/web test:e2e`.
  - Expected: setup project provisions the test user (visible in dev Clerk dashboard after first run), writes `apps/web/e2e/.auth/storage-state.json` and `test-user.json`; `authenticated/dashboard.spec.ts` passes; `unauthenticated/sign-in.spec.ts` passes.
  - If anything fails, capture the HTML report under `apps/web/playwright-report/` and address before marking complete.
  - Purpose: Final integration smoke before merge.
  - _Requirements: 6.1, 6.2, 6.3, NFR-Performance_
