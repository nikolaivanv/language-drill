# Implementation Plan

## Task Overview

Five independently shippable PRs, each opening a single upgrade group. Tasks are grouped by PR (1.x → 5.x) plus a closeout group (6.x). Within a PR, tasks are atomic edits to one or two files. Every PR ends with the same gate: `pnpm install && pnpm lint && pnpm typecheck && pnpm test` from the repo root, plus the smoke recipe noted in the design for PR 2 and PR 3.

## Steering Document Compliance

- File scope respects the existing monorepo layout (`apps/`, `packages/`, `infra/`) — no moves.
- Every PR title follows `chore(deps): <group>` per the Maintainability NFR.
- Each PR is rebased onto `main` immediately before opening (R7.2). Branches are not stacked.
- The pre-push gate from `CLAUDE.md` is the merge gate. No skipping `--no-verify`.

## Atomic Task Requirements

Each task touches 1–3 files, completes in 15–30 minutes, and produces one testable outcome. Where a task migrates call sites or configs, scope is bounded by upstream changelog deltas — if the upstream surface didn't change, the task is a no-op edit and `pnpm test` is the proof.

## Tasks

### PR 1 — `chore(deps): patch bundle`

- [x] 1.1 Bump root devDependencies in `package.json`
  - File: `package.json`
  - Bump: `prettier` → ^3.8.3
  - Purpose: Pick up the prettier patch.
  - _Leverage: `package.json`_
  - _Requirements: 1.1_

- [x] 1.2 Bump web app dependencies in `apps/web/package.json`
  - File: `apps/web/package.json`
  - Bump: `tailwindcss` → ^4.2.4, `@tailwindcss/postcss` → ^4.2.4, `@clerk/nextjs` → ^7.2.8, `@tanstack/react-query` → ^5.100.6, `jsdom` → ^29.1.0
  - Purpose: Clear all web-app patch/minor drift in one file edit.
  - _Leverage: `apps/web/package.json`_
  - _Requirements: 1.1, 1.4_

- [x] 1.3 Bump api-client dependencies in `packages/api-client/package.json`
  - File: `packages/api-client/package.json`
  - Bump: `@tanstack/react-query` → ^5.100.6, `jsdom` → ^29.1.0
  - Purpose: Keep api-client in lockstep with apps/web.
  - _Leverage: `packages/api-client/package.json`_
  - _Requirements: 1.1, 1.4_

- [x] 1.4 Bump lambda dependencies in `infra/lambda/package.json`
  - File: `infra/lambda/package.json`
  - Bump: `hono` → ^4.12.15, `svix` → ^1.92.2
  - Purpose: Clear lambda runtime patch drift.
  - _Leverage: `infra/lambda/package.json`_
  - _Requirements: 1.1_

- [x] 1.5 Bump CDK dependencies in `infra/package.json`
  - File: `infra/package.json`
  - Bump: `aws-cdk-lib` → ^2.251.0, `aws-cdk` → ^2.1120.0, `esbuild` → ^0.28.0
  - Purpose: Clear infra patch drift.
  - _Leverage: `infra/package.json`_
  - _Requirements: 1.1_

- [x] 1.6 Refresh lockfile and verify the patch bundle
  - Files: `pnpm-lock.yaml` (regenerated), PR description (drafted)
  - Run `pnpm install` from the repo root.
  - Run `pnpm lint && pnpm typecheck && pnpm test` and record wall-clock for the test run as the baseline for PR 4's Performance NFR.
  - Run `pnpm outdated -r` and confirm only PR 2–5 packages remain on the drift list.
  - Note any non-trivial install/build deprecation warnings in the PR description with a changelog link.
  - Purpose: Single verification gate for PR 1.
  - _Leverage: existing CI workflow, `pnpm outdated -r`_
  - _Requirements: 1.2, 1.3, 1.4_

- [x] 1.7 Confirm pin guarantees + audit posture for PR 1
  - Files: PR description (results recorded)
  - Run `pnpm list -r --depth=0 @types/node next zod typescript @hono/node-server` (or `grep` the lockfile) and confirm: `@types/node` 22.x, `next` 15.x, `zod` 3.x, `typescript` 5.x, `@hono/node-server` 1.x.
  - Confirm the `pnpm.overrides` block in the root `package.json` is byte-identical to `main`.
  - Run `pnpm audit --prod` and record the high/critical advisory count; merge is blocked if it regressed vs. `main`.
  - Purpose: Make R6 (pin guarantees) and the Security NFR explicit per-PR checkpoints.
  - _Leverage: `pnpm-lock.yaml`, `package.json` overrides_
  - _Requirements: 6.1, 6.2, 6.3, NFR Security_

### PR 2 — `chore(deps): drizzle + neon driver`

- [x] 2.1 Bump db package versions in `packages/db/package.json`
  - File: `packages/db/package.json`
  - Bump: `drizzle-orm` → ^0.45.2, `drizzle-kit` → ^0.31.10, `@neondatabase/serverless` → ^1.1.0
  - Purpose: Move the data-layer source of truth onto the new majors.
  - _Leverage: `packages/db/package.json`_
  - _Requirements: 2.1_

- [x] 2.2 Bump drizzle in `infra/lambda/package.json`
  - File: `infra/lambda/package.json`
  - Bump: `drizzle-orm` → ^0.45.2 (must match `packages/db`)
  - Purpose: Keep lambda pinned to the same drizzle major as the schema package.
  - _Leverage: `infra/lambda/package.json`_
  - _Requirements: 2.1_

- [x] 2.3 Refresh lockfile and confirm clean migration journal
  - Files: `pnpm-lock.yaml`, `packages/db/migrations/meta/_journal.json` (read-only check)
  - Run `pnpm install`.
  - Run `pnpm db:generate` and confirm the journal diff against `main` is empty (or, if non-empty, that the change is purely metadata-equivalent — see Error Handling §Scenario 2).
  - Purpose: Catch spurious-migration drift early.
  - _Leverage: `packages/db/migrations/meta/_journal.json`, `drizzle-kit generate`_
  - _Requirements: 2.2_

- [x] 2.4 Migrate any drizzle API call-sites in `packages/db/src/**`
  - Files: only files that fail to typecheck after the bump (likely 0–3 files under `packages/db/src/schema/` or `packages/db/src/index.ts`)
  - Run `pnpm --filter @language-drill/db typecheck` first; fix only the errors it reports.
  - Skip this task entirely if typecheck is already clean.
  - Purpose: Migrate any breaking surface that landed between drizzle 0.30 and 0.45.
  - _Leverage: `packages/db/src/**`, drizzle-orm changelog_
  - _Requirements: 2.3_

- [x] 2.5 Migrate any drizzle API call-sites in `infra/lambda/src/routes/**`
  - Files: only files that fail to typecheck after the bump (most likely `infra/lambda/src/routes/profiles.ts` and other route files using drizzle queries)
  - Run `pnpm --filter @language-drill/lambda typecheck`; fix only the errors.
  - Skip this task entirely if typecheck is already clean.
  - Purpose: Same as 2.4, but for the lambda surface.
  - _Leverage: `infra/lambda/src/routes/**`, drizzle-orm changelog_
  - _Requirements: 2.3_

- [x] 2.6 Migrate against a fresh Neon branch
  - Files: none (operational task)
  - Create or use an ephemeral Neon branch (`neonctl branches create` or via the Neon UI), point a temporary `DATABASE_URL` at it, run `pnpm db:migrate`. Confirm exit zero.
  - Purpose: Prove migrations apply cleanly on the new drizzle-kit before merge.
  - _Leverage: existing `pnpm db:migrate` script, Neon branching_
  - _Requirements: 2.4_

- [x] 2.7 Verify the data layer end-to-end
  - Files: PR description (smoke notes)
  - Run `pnpm lint && pnpm typecheck && pnpm test` from the repo root.
  - Run the smoke recipe from `design.md` §Manual Smoke Recipe step 3 (`pnpm dev`, fetch an exercise list, confirm rows render).
  - Purpose: Final verification gate for PR 2.
  - _Leverage: pre-push gate, local dev harness (`infra/lambda/src/dev.ts`)_
  - _Requirements: 2.5_

- [x] 2.8 Confirm pin guarantees + audit posture for PR 2
  - Files: PR description (results recorded)
  - Repeat task 1.7 verbatim against PR 2's lockfile state.
  - Purpose: Same as 1.7, applied to PR 2.
  - _Leverage: `pnpm-lock.yaml`, `package.json` overrides_
  - _Requirements: 6.1, 6.2, 6.3, NFR Security_

### PR 3 — `chore(deps): anthropic sdk`

- [x] 3.1 Bump anthropic SDK in `packages/ai/package.json`
  - File: `packages/ai/package.json`
  - Bump: `@anthropic-ai/sdk` → ^0.91.1
  - Purpose: Move the AI wrapper onto the current SDK.
  - _Leverage: `packages/ai/package.json`_
  - _Requirements: 3.1_

- [x] 3.2 Refresh lockfile and surface the breakage
  - File: `pnpm-lock.yaml`
  - Run `pnpm install` then `pnpm --filter @language-drill/ai typecheck`. The typecheck output is the migration worklist for 3.3.
  - Purpose: Bounded enumeration of the call-sites that need migration.
  - _Leverage: `packages/ai/src/**`_
  - _Requirements: 3.2_

- [x] 3.3 Migrate SDK call-sites in `packages/ai/src/**`
  - Files: every file flagged by 3.2 (typecheck errors). Most likely the Claude client wrapper file and any prompt-template helpers that import SDK types.
  - Resolve each typecheck error using the SDK's current API (refer to anthropic-sdk-typescript releases between 0.36 and 0.91). Keep all changes inside `packages/ai/` — do not leak SDK types into `packages/api-client` or `infra/lambda`.
  - **Bound:** if 3.2's worklist exceeds 3 files, split this task into 3.3a, 3.3b, 3.3c (one file each, sequenced by call-graph leaf → root) before starting.
  - Purpose: Bring the wrapper onto the current SDK without widening the bulkhead.
  - _Leverage: `packages/ai/src/**`, anthropic-sdk-typescript changelog, `tech.md` §7 prompt-caching_
  - _Requirements: 3.2_

- [x] 3.4 Run unit and integration tests
  - Files: PR description (results recorded)
  - Run `pnpm --filter @language-drill/ai test`, `pnpm --filter @language-drill/lambda test`, `pnpm --filter @language-drill/api-client test`.
  - Purpose: Confirm the wrapper boundary held — no test in `infra/lambda` or `api-client` should require edits.
  - _Leverage: existing test suites_
  - _Requirements: 3.5_

- [x] 3.5 Smoke-test prompt caching against `claude-sonnet-4-6`
  - Files: PR description (cache-hit field name + observed values recorded)
  - With a real `ANTHROPIC_API_KEY` set, run the local exercise-generation flow twice within the cache TTL. Capture the SDK's cache-usage telemetry on call 2 and confirm a cache hit.
  - Submit one cloze answer locally and confirm `POST /exercises/:id/submit` returns the same JSON shape as `main`.
  - Purpose: End-to-end proof the Anthropic upgrade doesn't regress the cost-saving prompt cache or the API contract.
  - _Leverage: local dev harness, existing exercise generation route_
  - _Requirements: 3.3, 3.4_

- [x] 3.6 Confirm pin guarantees + audit posture for PR 3
  - Files: PR description (results recorded)
  - Repeat task 1.7 verbatim against PR 3's lockfile state.
  - Purpose: Same as 1.7, applied to PR 3.
  - _Leverage: `pnpm-lock.yaml`, `package.json` overrides_
  - _Requirements: 6.1, 6.2, 6.3, NFR Security_

### PR 4 — `chore(deps): vitest stack`

- [x] 4.1 Bump vitest in every workspace `package.json`
  - Files: `package.json` (root has no vitest dep — skip if absent), `apps/web/package.json`, `infra/lambda/package.json`, `packages/ai/package.json`, `packages/api-client/package.json`, `packages/db/package.json`, `packages/shared/package.json`
  - Bump: `vitest` → ^4.1.5 in each devDependencies block.
  - Purpose: Move every workspace's test runner onto v4 in one atomic edit pass.
  - _Leverage: Bash glob `grep -l vitest packages/*/package.json infra/lambda/package.json apps/web/package.json` confirms the file list_
  - _Requirements: 4.1_

- [x] 4.2 Bump `@vitejs/plugin-react` in `apps/web` and `packages/api-client`
  - Files: `apps/web/package.json`, `packages/api-client/package.json`
  - Bump: `@vitejs/plugin-react` → ^6.0.1 in each.
  - Purpose: Pair the plugin major with vitest 4.
  - _Leverage: existing devDependencies_
  - _Requirements: 4.1_

- [x] 4.3 Refresh lockfile and surface config breakage
  - File: `pnpm-lock.yaml`
  - Run `pnpm install` then `pnpm test`. Capture every config-related error or deprecation message — that list bounds task 4.4.
  - Purpose: Enumerate what (if anything) needs migrating in vitest.config files.
  - _Leverage: existing `pnpm test` script chain_
  - _Requirements: 4.2, 4.3_

- [x] 4.4 Migrate `vitest.config.ts` shape in each workspace
  - Files: only the files flagged by 4.3, drawn from `apps/web/vitest.config.ts`, `infra/lambda/vitest.config.ts`, `packages/ai/vitest.config.ts`, `packages/shared/vitest.config.ts` (4 known configs; `packages/db` and `packages/api-client` use defaults).
  - Apply the minimum diff to satisfy v2/v3/v4 config shape changes (workspace shape, environment defaults, test runner option renames). Do not introduce new options not previously used.
  - Purpose: Restore green tests under vitest 4.
  - _Leverage: existing vitest configs, vitest migration guides_
  - _Requirements: 4.3, 4.4_

- [x] 4.5 Final verification + Performance NFR check
  - Files: PR description (timing recorded)
  - Run `pnpm test` from the repo root and capture wall-clock; compare to PR 1 task 1.6 baseline. If regression > +25%, document a justification per the Performance NFR (or revert and split the offending workspace into a follow-up).
  - Run `pnpm lint && pnpm typecheck` to confirm no orthogonal regression.
  - Purpose: Final gate for PR 4.
  - _Leverage: pre-push gate_
  - _Requirements: 4.2, 4.4, NFR Performance_

- [x] 4.6 Confirm pin guarantees + audit posture for PR 4
  - Files: PR description (results recorded)
  - Repeat task 1.7 verbatim against PR 4's lockfile state.
  - Purpose: Same as 1.7, applied to PR 4.
  - _Leverage: `pnpm-lock.yaml`, `package.json` overrides_
  - _Requirements: 6.1, 6.2, 6.3, NFR Security_

### PR 5 — `chore(deps): eslint flat config`

- [x] 5.1 Bump eslint and `@typescript-eslint/*` in root `package.json`
  - File: `package.json`
  - Bump: `eslint` → ^9.0.0 (start at 9; 10 only if 9 is itself drift-free at the time the PR opens), `@typescript-eslint/eslint-plugin` → ^8.59.1, `@typescript-eslint/parser` → ^8.59.1
  - Purpose: Move the lint gate off the EOL ESLint 8 line.
  - _Leverage: `package.json`_
  - _Requirements: 5.1_

- [x] 5.2 Replace `.eslintrc.base.js` with a flat-config equivalent
  - Files: `.eslintrc.base.js` (delete), `eslint.config.js` (new) — net 1 file added, 1 removed
  - Port every rule, plugin, and parser option from the legacy base into the flat-config schema. If a plugin lacks flat-config support, list it for documentation in 5.5.
  - Purpose: Establish the single shared ESLint config for the workspace.
  - _Leverage: `.eslintrc.base.js`, `@eslint/migrate-config` codemod, `@typescript-eslint/parser` flat-config docs_
  - _Requirements: 5.2_

- [x] 5.3 Replace `.eslintrc.js` with a flat-config delta on top of `eslint.config.js`
  - Files: `.eslintrc.js` (delete), root `eslint.config.js` extended (or a sibling `eslint.config.mjs`)
  - Port any root-only overrides from `.eslintrc.js` into the flat config produced in 5.2. If `.eslintrc.js` only re-exports the base, this collapses to a single config file.
  - Purpose: Eliminate the last legacy config at the root.
  - _Leverage: `.eslintrc.js`_
  - _Requirements: 5.2_

- [x] 5.4 Confirm `next lint` (`apps/web`) recognises the flat config
  - Files: `apps/web/package.json` (only if the `lint` script needs adjusting), possibly `apps/web/eslint.config.mjs` if web needs its own override layer.
  - Run `pnpm --filter @language-drill/web lint`. If Next 15's `next lint` rejects flat config, set `useFlatConfig` per Next 15 docs or move web to a workspace-local `eslint.config.mjs` that re-exports the root config.
  - Purpose: Keep `apps/web` lint coverage equivalent to `main`.
  - _Leverage: Next 15 docs on flat config, root `eslint.config.js`_
  - _Requirements: 5.3_

- [x] 5.5 Run `pnpm lint`, document any deferred rules
  - Files: PR description
  - Run `pnpm lint` from the repo root. Confirm exit zero. Compare warning/error count to `main` — count must not drop, otherwise rules were silently lost.
  - For any rule that couldn't be ported (per 5.2), list it in the PR description with the upstream tracking issue or replacement plugin.
  - Purpose: Final gate for PR 5.
  - _Leverage: pre-push gate, `pnpm lint`_
  - _Requirements: 5.3, 5.4_

- [x] 5.6 Confirm pin guarantees + audit posture for PR 5
  - Files: PR description (results recorded)
  - Repeat task 1.7 verbatim against PR 5's lockfile state.
  - Purpose: Same as 1.7, applied to PR 5.
  - _Leverage: `pnpm-lock.yaml`, `package.json` overrides_
  - _Requirements: 6.1, 6.2, 6.3, NFR Security_

### PR 6 — `chore(deps): mark audit rolled out` (closeout)

- [x] 6.1 Annotate `docs/dependency-audit.md` with rollout status
  - File: `docs/dependency-audit.md`
  - Add a `Status: rolled out YYYY-MM-DD` line directly under the title (or replace the doc with a fresh `pnpm outdated -r` snapshot, whichever the maintainer prefers at the time).
  - Purpose: Closeout marker per the Maintainability NFR; future audits start from a known clean baseline.
  - _Leverage: `docs/dependency-audit.md`_
  - _Requirements: NFR Maintainability_

## R6 / Security — handled per-PR

The pin guarantees from R6 and the Security NFR are now executed as tasks 1.7 / 2.8 / 3.6 / 4.6 / 5.6 — one per PR, all with the same verification recipe (`pnpm list -r --depth=0` for the held-back set, byte-identical `pnpm.overrides`, `pnpm audit --prod` not regressed vs. `main`). R7 (rollout isolation) is enforced at the workflow level — see "Steering Document Compliance" at the top of this document.
