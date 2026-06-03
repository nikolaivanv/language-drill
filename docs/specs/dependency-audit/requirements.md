# Requirements Document

## Introduction

Execute the dependency upgrade plan captured in `docs/dependency-audit.md`. The audit identified 11 safe patch/minor bumps, 4 worthwhile major upgrades, an ESLint flat-config migration, and a set of strategic deferrals. This spec turns that plan into a sequenced, verifiable rollout of one PR per upgrade group, so each landing keeps `pnpm lint`, `pnpm typecheck`, and `pnpm test` green and leaves the production runtime (`@types/node` 22 = AWS Lambda LTS) untouched.

## Alignment with Product Vision

`CLAUDE.md` mandates "always use the latest stable version of packages unless there's a specific reason to pin." The audit found the workspace drifting on its highest-leverage dependencies — `@anthropic-ai/sdk` (the wrapper around every Claude call that powers exercise evaluation, the product's core differentiator), `drizzle-orm`/`@neondatabase/serverless` (the data layer for progress tracking), and `vitest` (the gate that protects all the above). Bringing these current keeps the codebase portfolio-quality, removes EOL-software risk on `eslint` 8, and pulls in prompt-caching ergonomics from newer Anthropic SDK releases that directly support the per-session ~80% cost reduction documented in `docs/architecture.md`.

## Requirements

### Requirement 1 — Patch/minor bundle (PR 1)

**User Story:** As the maintainer, I want every safe patch/minor bump in the audit applied in a single PR, so that I clear the easy drift in one review pass.

#### Acceptance Criteria

1. WHEN the PR lands THEN every package listed in the audit's "Safe patch/minor bumps" table SHALL be at the "Latest" version recorded there as of the audit's generation date (2026-04-29) or newer (`prettier`, `tailwindcss`, `@tailwindcss/postcss`, `hono`, `@clerk/nextjs`, `@tanstack/react-query`, `aws-cdk`, `aws-cdk-lib`, `svix`, `jsdom`, `esbuild`).
2. WHEN `pnpm lint && pnpm typecheck && pnpm test` runs from the repo root on the PR branch THEN all three commands SHALL exit zero.
3. IF any package in the bundle introduces a non-trivial deprecation warning at install or build time THEN the PR description SHALL note it and link to the upstream changelog entry.
4. WHEN the PR is opened THEN the diff SHALL be limited to `package.json` files, `pnpm-lock.yaml`, and any minimal config changes those bumps strictly require — no unrelated refactors.

### Requirement 2 — Drizzle + Neon driver (PR 2)

**User Story:** As the maintainer, I want the data-layer dependencies upgraded together against an ephemeral Neon branch, so that schema changes and runtime SQL are validated before merging.

#### Acceptance Criteria

1. WHEN the PR lands THEN `drizzle-orm` SHALL be at 0.45.x or newer, `drizzle-kit` SHALL be at 0.31.x or newer, and `@neondatabase/serverless` SHALL be at 1.x in both `packages/db` and `infra/lambda`.
2. WHEN `pnpm db:generate` runs on the PR branch THEN it SHALL produce a clean `_journal.json` diff (or no diff) — no spurious migrations from version-only changes.
3. IF the Drizzle bump changes any query builder API used in `infra/lambda/src/routes/**` or `packages/db/src/**` THEN those call sites SHALL be updated in the same PR and covered by existing tests.
4. WHEN `pnpm db:migrate` runs against a fresh Neon branch THEN it SHALL apply all migrations without error.
5. WHEN `pnpm test` runs THEN every `packages/db` and `infra/lambda` test SHALL pass.

### Requirement 3 — Anthropic SDK (PR 3)

**User Story:** As the maintainer, I want `@anthropic-ai/sdk` upgraded from 0.36 to 0.91+, so that the AI layer uses the current SDK surface and prompt-caching ergonomics.

#### Acceptance Criteria

1. WHEN the PR lands THEN `@anthropic-ai/sdk` SHALL be at 0.91.x or newer in `packages/ai`.
2. WHEN any client code in `packages/ai/src/**` references SDK types or methods that were renamed/removed between 0.36 and 0.91 THEN the call sites SHALL be migrated to the current API in the same PR.
3. WHEN exercise generation is triggered locally against `claude-sonnet-4-6` THEN it SHALL return a valid response and the prompt cache SHALL be exercised (verified via the SDK's cache-hit field on a second call within the cache TTL).
4. WHEN answer evaluation is triggered locally THEN `POST /exercises/:id/submit` SHALL return a 2xx with the existing JSON shape — no contract change leaking to the API client.
5. WHEN `pnpm test` runs THEN every `packages/ai`, `infra/lambda`, and `packages/api-client` test SHALL pass.

### Requirement 4 — Vitest stack (PR 4)

**User Story:** As the maintainer, I want `vitest` and `@vitejs/plugin-react` upgraded together, so that the test gate stays current and supports newer React/TS toolchains.

#### Acceptance Criteria

1. WHEN the PR lands THEN `vitest` SHALL be at 4.x and `@vitejs/plugin-react` SHALL be at 6.x in every workspace that currently depends on them.
2. WHEN `pnpm test` runs from the repo root THEN every workspace SHALL execute its suite and exit zero.
3. IF any vitest config file (`vitest.config.*`, workspace config) requires a shape change for v2/v3/v4 compatibility THEN the change SHALL be applied in the same PR.
4. WHEN the suite runs THEN no test SHALL emit a deprecation warning from vitest itself (warnings from upstream React Testing Library etc. are out of scope).

### Requirement 5 — ESLint flat config (PR 5)

**User Story:** As the maintainer, I want ESLint upgraded off the EOL 8.x line and onto flat config, so that the linter stays supported and integrates cleanly with `next lint` on Next 15+.

#### Acceptance Criteria

1. WHEN the PR lands THEN `eslint` SHALL be at 9.x or newer and `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` SHALL be at 8.x or newer.
2. WHEN the PR lands THEN every `.eslintrc*` legacy config in the repo SHALL be replaced by flat-config equivalents (`eslint.config.js` or `eslint.config.mjs`).
3. WHEN `pnpm lint` runs from the repo root THEN it SHALL exit zero with the same set of files linted as before — no rule loosening to silence migration noise.
4. IF any rule cannot be ported because its plugin lacks flat-config support THEN the PR description SHALL list each such rule and either name a replacement plugin or document the temporary gap.

### Requirement 6 — Pin guarantees and deferred items

**User Story:** As the maintainer, I want hard guarantees that this rollout never touches deferred or pinned packages, so that no surprise majors slip in via transitive resolution.

#### Acceptance Criteria

1. WHEN any PR in this spec lands THEN `@types/node` SHALL remain at `^22.0.0` and the `pnpm.overrides` entry in the root `package.json` SHALL be unchanged.
2. WHEN any PR in this spec lands THEN `next`, `zod`, `typescript`, and `@hono/node-server` SHALL remain at their pre-spec versions (15.x, 3.x, 5.x, 1.x respectively).
3. IF a transitive dependency upgrade in `pnpm-lock.yaml` would force any of the above past its pinned line THEN the PR SHALL add or extend a `pnpm.overrides` entry to hold it back, with a comment in `package.json` explaining why.

### Requirement 7 — Rollout isolation

**User Story:** As the maintainer, I want each PR limited to one upgrade group, so that a regression can be reverted without losing unrelated upgrades.

#### Acceptance Criteria

1. WHEN PRs are opened THEN no single PR SHALL combine two of the five upgrade groups (R1–R5).
2. WHEN a PR is merged THEN the next PR in the sequence SHALL be rebased onto `main` before opening, so each PR's diff reflects only its own changes.
3. IF a PR fails CI THEN it SHALL be revertable with `git revert` on its merge commit without breaking subsequent PRs in the sequence.

## Non-Functional Requirements

### Reliability
- Every PR MUST keep `pnpm lint`, `pnpm typecheck`, and `pnpm test` green at the repo root before being marked ready for review.
- The Drizzle and Anthropic PRs MUST be smoke-tested against the local dev stack (`pnpm dev` with `DEV_USER_ID=dev_user_001`, real `ANTHROPIC_API_KEY`, real Neon branch) — version-bump–only verification is insufficient for these two.

### Security
- No PR in this spec MAY ship with a `pnpm audit` `high` or `critical` advisory regression compared to `main`.
- No PR MAY introduce or upgrade a package flagged as deprecated by npm — if upstream deprecates a transitive, document the replacement plan in the PR description.

### Maintainability
- Each PR title MUST follow the form `chore(deps): <group>` so the rollout is greppable in `git log`.
- After all five PRs land, `docs/dependency-audit.md` MUST be updated with a "Status: rolled out YYYY-MM-DD" line at the top, or replaced by a fresh audit run.

### Performance
- No PR may regress `pnpm test` wall-clock time at the repo root by more than 25% versus `main` baseline. If a major (vitest, drizzle) does, the PR description MUST justify it.

### Usability
- N/A — this spec is an internal dependency rollout with no UI surface changes. The four NFR buckets in the template are Performance / Security / Reliability / Usability; this spec swaps Usability for Maintainability because the audience is the maintainer, not an end user.
