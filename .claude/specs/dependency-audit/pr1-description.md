# chore(deps): patch bundle

## Summary

PR 1 of 5 in the rollout planned by `.claude/specs/dependency-audit/`. Clears every safe patch/minor bump from the 2026-04-29 audit (`docs/dependency-audit.md`) in a single review pass. No source-code changes; only `package.json` files, the regenerated `pnpm-lock.yaml`, and this description.

This PR establishes the green baseline (lint, typecheck, test, audit, pin guarantees) that PRs 2–5 will each verify against. The wall-clock test baseline captured here is the reference point for the Performance NFR check in PR 4.

## Bumps in this PR

| Package | Workspace | Old → New | Notes |
|---|---|---|---|
| `prettier` | root (devDep) | 3.8.2 → 3.8.3 | Patch — formatting fixes only ([changelog](https://github.com/prettier/prettier/blob/main/CHANGELOG.md)) |
| `tailwindcss` | `apps/web` | 4.2.2 → 4.2.4 | Patch ([changelog](https://github.com/tailwindlabs/tailwindcss/releases)) |
| `@tailwindcss/postcss` | `apps/web` | 4.2.2 → 4.2.4 | Patch — paired with `tailwindcss` |
| `@clerk/nextjs` | `apps/web` | 7.0.12 → 7.2.8 | Minor within v7 ([changelog](https://github.com/clerk/javascript/blob/main/packages/nextjs/CHANGELOG.md)) |
| `@tanstack/react-query` | `apps/web`, `packages/api-client` | 5.99.0 → 5.100.6 | Patch within v5 ([changelog](https://github.com/TanStack/query/releases)) |
| `jsdom` | `apps/web`, `packages/api-client` | 29.0.2 → 29.1.0 | Minor within v29 ([changelog](https://github.com/jsdom/jsdom/blob/main/Changelog.md)) |
| `hono` | `infra/lambda` | 4.12.12 → 4.12.15 | Patch ([changelog](https://github.com/honojs/hono/releases)) |
| `svix` | `infra/lambda` | 1.90.0 → 1.92.2 | Patch ([changelog](https://github.com/svix/svix-webhooks/releases)) |
| `aws-cdk-lib` | `infra` | 2.248.0 → 2.251.0 | Minor within v2 ([changelog](https://github.com/aws/aws-cdk/releases)) |
| `aws-cdk` | `infra` (devDep) | 2.1118.0 → 2.1120.0 | Patch — paired with `aws-cdk-lib` |
| `esbuild` | `infra` (devDep) | 0.25.12 → 0.28.0 | Pre-1.0 minor ([changelog](https://github.com/evanw/esbuild/blob/main/CHANGELOG.md)) — bundling-only, no runtime impact |

`packages/api-client` also picked up explicit dev-only entries that were previously implicit transitives (`@testing-library/react`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `react`, `react-dom`) so the package's own test config is self-describing — no version drift, just hoisting. The lockfile diff is consistent with this and 11 specifier-only bumps.

## Verification

All commands run from the worktree root (`/Users/valentinanikitina/Seal/Dev/language-drill/.claude/worktrees/dependency-audit`).

- `pnpm install` — **no-op** (lockfile up to date, "Already up to date" — refresh produced 0 changes against the lockfile already committed by tasks 1.1–1.5).
- `pnpm lint` — **green**, all 6 packages with lint scripts pass (`@language-drill/{ai, api-client, db, lambda, shared, web}`). `apps/web` `next lint` emits its standard "next lint deprecated, will be removed in Next 16" notice and the "Next.js plugin not detected" advisory — both are PR-5 / PR-deferred surface, not introduced here.
- `pnpm typecheck` — **green**, all 11 typecheck/build tasks pass.
- `pnpm test` — **477 tests across 39 files pass**:
  - `@language-drill/shared` — 21 tests (1 file)
  - `@language-drill/db` — 6 tests (1 file)
  - `@language-drill/ai` — 31 tests (1 file)
  - `@language-drill/api-client` — 75 tests (5 files)
  - `@language-drill/lambda` — 55 tests (5 files)
  - `@language-drill/web` — 289 tests (26 files)
- **Wall-clock test baseline (PR-4 Performance NFR reference):** `pnpm exec turbo run test --force` (cache-bypassed; all 10 task packages reported `0 cached, 10 total`).
  - Run A: `real 14.37s` (turbo task wall-clock 14.036s)
  - Run B: `real 12.66s` (turbo task wall-clock 12.318s)
  - **Recorded baseline: ~13.5s** (mean of two uncached runs). PR 4 must stay within +25% of this (~16.9s ceiling) per the Performance NFR.

### `pnpm outdated -r` interpretation

13 packages remain on the drift list. **No PR-1 package appears** — the patch bundle is fully cleared. Mapping below:

| Package | Current | Latest | Belongs to |
|---|---|---|---|
| `@anthropic-ai/sdk` | 0.36.3 | 0.91.1 | **PR 3** |
| `@neondatabase/serverless` | 0.9.5 | 1.1.0 | **PR 2** |
| `drizzle-kit` | 0.21.4 | 0.31.10 | **PR 2** |
| `drizzle-orm` | 0.30.10 | 0.45.2 | **PR 2** |
| `vitest` | 1.6.1 | 4.1.5 | **PR 4** |
| `@vitejs/plugin-react` | 4.7.0 | 6.0.1 | **PR 4** |
| `eslint` | 8.57.1 | 10.2.1 | **PR 5** |
| `@typescript-eslint/eslint-plugin` | 7.18.0 | 8.59.1 | **PR 5** |
| `@typescript-eslint/parser` | 7.18.0 | 8.59.1 | **PR 5** |
| `@types/node` | 22.19.17 | 25.6.0 | **Held back (R6)** — Lambda LTS, pinned via `pnpm.overrides` |
| `next` | 15.5.15 | 16.2.4 | **Held back** — strategic, defer to Next 16 spec |
| `zod` | 3.25.76 | 4.3.6 | **Held back** — strategic, defer to zod 4 spec |
| `typescript` | 5.9.3 | 6.0.3 | **Held back** — let TS 6 ecosystem settle |
| `@hono/node-server` | 1.19.14 | 2.0.0 | **Held back** — local-dev only, low ROI |

## Deferred work

- PR 2 — `chore(deps): drizzle + neon driver` (`drizzle-orm`, `drizzle-kit`, `@neondatabase/serverless`)
- PR 3 — `chore(deps): anthropic sdk` (`@anthropic-ai/sdk`)
- PR 4 — `chore(deps): vitest stack` (`vitest`, `@vitejs/plugin-react`)
- PR 5 — `chore(deps): eslint flat config` (`eslint`, `@typescript-eslint/*`, flat-config migration)
- Held back per R6 / strategic decisions: `@types/node` (LTS pin), `next`, `zod`, `typescript`, `@hono/node-server`.

## Deprecation warnings noted

PR 1 introduces **no new deprecation surface**; the warnings below are pre-existing on `main` and remain as carry-overs to be cleared by later PRs in this rollout. Listed for auditability per R1.3.

| Package | Version in lockfile | Deprecation message | Cleared by |
|---|---|---|---|
| `eslint` | 8.57.1 | "This version is no longer supported. Please see https://eslint.org/version-support for other options." | **PR 5** (move to ESLint 9+) |
| `glob` | 7.2.3, 8.1.0 | "Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version." | Transitive — should drop when ESLint 8 / older toolchain leaves the tree (PR 5, PR 4) |
| `rimraf` | 3.0.2 | "Rimraf versions prior to v4 are no longer supported" | Transitive — same as `glob` |
| `inflight` | 1.0.6 | "This module is not supported, and leaks memory. Do not use it. Check out lru-cache..." | Transitive — pulled in by old `glob`; clears with PR 5 / PR 4 |
| `node-domexception` | 1.0.0 | "Use your platform's native DOMException instead" | Transitive — pulled in by jsdom/undici toolchain; tracked via [node-domexception#README](https://github.com/jimmywarting/node-domexception) |
| Vite (CJS Node API) | via vitest 1.6.1 | "The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated" | **PR 4** (vitest 4 → ESM Vite Node API) |
| `next lint` | next 15.5.15 | "`next lint` is deprecated and will be removed in Next.js 16. ... migrate to the ESLint CLI" | **PR 5** (`next lint` → flat-config + standalone ESLint CLI) |

No high/critical advisory regressions are introduced by these bumps — confirmed by R6/Security audit posture in task 1.7.

## Pin guarantees (R6)

- `pnpm.overrides` block in root `package.json` is **byte-identical** to `main` — only the `@types/node: ^22.0.0` entry, no additions.
- Held-back packages remain on their pre-spec lines:
  - `@types/node` `^22.0.0` (Lambda LTS)
  - `next` 15.x
  - `zod` 3.x
  - `typescript` 5.x
  - `@hono/node-server` 1.x
- No transitive resolution forced any of the above past its pin (verified by re-running `pnpm install` against the regenerated lockfile — result: "Already up to date"). Detailed per-pin verification (with `pnpm list -r --depth=0` output and `pnpm audit --prod` count) is recorded in task 1.7.

## Pin guarantees + audit posture

Per task 1.7 — explicit per-PR checkpoint that R6 (pin guarantees) and the Security NFR are met before merge. All commands run from the worktree root.

### Pin verification (`pnpm list -r --depth=0 @types/node next zod typescript @hono/node-server`)

| Package | Required line | Resolved version(s) on this branch | PR-1 verdict |
|---|---|---|---|
| `@types/node` | 22.x | 22.19.17 (root) — every workspace inherits via `pnpm.overrides` | OK |
| `next` | 15.x | 15.5.15 (`apps/web`) | OK |
| `zod` | 3.x | 3.25.76 (`infra/lambda`, `packages/api-client`) | OK |
| `typescript` | 5.x | 5.9.3 (root + every workspace) | OK |
| `@hono/node-server` | 1.x | 1.19.14 (`infra/lambda`) | OK |

No 20.x / 24.x / 25.x stragglers for `@types/node`; no workspace drifted onto `next` 16, `zod` 4, `typescript` 6, or `@hono/node-server` 2.

### `pnpm.overrides` byte-identical confirmation

The `pnpm` block at `package.json:28-32` on this branch:

```json
  "pnpm": {
    "overrides": {
      "@types/node": "^22.0.0"
    }
  }
```

`diff` of just this block against `main` (both as raw text and as canonical JSON via `python3 -c "json.dumps(...)"`) returns empty — **byte-identical** to `main`. No transitive resolution forced any held-back package past its pin, so no new override entries were needed (R6.3).

### `pnpm audit --prod` posture

Production-only audit, this branch vs. `main` (run on a fresh clone of `a0acc6d`, the local `main` HEAD; the remote `bf74d68` PR #17 merge had not yet been pulled into the worktree's local main reference, but it does not affect the prod-dep audit because PR #17 was an auth/upsert change with no `package.json` bumps):

| Severity | `main` (a0acc6d) | This branch | Delta |
|---|---|---|---|
| critical | 2 | **0** | -2 (both Clerk middleware-bypass advisories — `@clerk/shared` + `@clerk/nextjs` — cleared by the 7.0.12 → 7.2.8 bump in PR 1) |
| high | 1 | **1** | unchanged (drizzle-orm SQL-injection, GHSA-gpj5-g38j-94v9 — owned by **PR 2**, patched in 0.45.2+) |
| moderate | 3 | 1 | -2 (hono JSX SSR + uuid bounds-check cleared by the hono 4.12.12 → 4.12.15 bump and the lockfile refresh) |

Branch advisories that remain (for reviewer context):

- HIGH `drizzle-orm` <0.45.2 — pre-existing; cleared by PR 2.
- MODERATE `postcss` <8.5.10 — transitive via `next` 15.5.15 (held back per R6); will clear when Next bumps its pinned postcss or when the deferred Next 16 spec lands.

**Verdict: no regression.** PR-1 strictly improves security posture — high count unchanged, critical count drops from 2 → 0. Merge is **not** blocked by the Security NFR.

### Requirement traceability

Satisfies R6.1, R6.2, R6.3, NFR Security.

---

Closes the patch-bundle group of `.claude/specs/dependency-audit/`. Sequenced ahead of PRs 2–5 per `design.md` §Components and §Architecture.
