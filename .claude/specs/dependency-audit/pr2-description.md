# chore(deps): drizzle + neon driver

## Summary

PR 2 of 5 in the rollout planned by `.claude/specs/dependency-audit/`. Moves the data layer from `drizzle-orm` 0.30 → 0.45.2, `drizzle-kit` 0.21 → 0.31.10, and `@neondatabase/serverless` 0.9 → 1.1.0 across `packages/db` and `infra/lambda`.

The headline security win: this PR **clears the HIGH `drizzle-orm` SQL-injection advisory** (GHSA-gpj5-g38j-94v9) — it was the last HIGH on `main` and is now gone. Data-layer round-trip was smoke-tested locally (`pnpm dev` + 5 exercise probes returning HTTP 200). Migration evidence against a fresh Neon branch is delegated to CI's `neon-migrate` job; the task-2.6 box flips to `[x]` once that job is green and the run URL is recorded below.

No source-code changes. Diff is `package.json` files, `pnpm-lock.yaml`, three drizzle-kit snapshot files (metadata-equivalent — see Migration journal hygiene), and this description.

## Bumps in this PR

| Package | Workspace | Old → New | Notes |
|---|---|---|---|
| `drizzle-orm` | `packages/db`, `infra/lambda` | 0.30.10 → 0.45.2 | Major (15 minor releases). Patches GHSA-gpj5-g38j-94v9 (HIGH SQL-injection). Versions kept in lockstep across the two workspaces per design.md §Components. ([changelog](https://github.com/drizzle-team/drizzle-orm/releases)) |
| `drizzle-kit` | `packages/db` | 0.21.4 → 0.31.10 | Major. Snapshot serializer format upgraded — see Migration journal hygiene. ([changelog](https://github.com/drizzle-team/drizzle-orm/releases?q=drizzle-kit)) |
| `@neondatabase/serverless` | `packages/db` | 0.9.5 → 1.1.0 | Pre-1.0 → 1.x. WebSocket transport unchanged at the import surface. ([changelog](https://github.com/neondatabase/serverless/releases)) |

## Migration journal hygiene

Per design.md Scenario 2 ("spurious Drizzle migration in `_journal.json`"): the new drizzle-kit serializer rewrites snapshot metadata even when the schema is byte-identical. Verdict from task 2.3:

- `pnpm db:generate` reports **"No schema changes, nothing to migrate"** — no spurious migration was generated.
- `packages/db/migrations/meta/_journal.json` is **byte-unchanged** vs. `main`.
- The three snapshot files under `packages/db/migrations/meta/` were rewritten by `drizzle-kit up` to the new serializer format:
  - `0000_snapshot.json`
  - `0001_snapshot.json`
  - `0002_snapshot.json`
  These are **metadata-equivalent** — the schema content (tables, columns, indexes, constraints) is identical; only the serializer's wrapper format moved. This is the expected outcome per design.md §Error Handling Scenario 2.

## Source migration

- **No `packages/db/src/**` files modified** (task 2.4 was a no-op — typecheck was already clean against drizzle 0.45.2 after the version bump).
- **No `infra/lambda/src/**` files modified** (task 2.5).

The lambda's typecheck initially appeared to fail with 53 errors, but the root cause was a **stale `packages/db/dist/`** — the published `.d.ts` files were from the previous drizzle 0.30 build and held old type signatures. After `pnpm --filter @language-drill/db build`, the lambda typecheck went green with zero source edits.

**Reviewer note:** turbo's `dependsOn: ["^build"]` chain rebuilds `packages/db` automatically when running through turbo. Reviewers running:

```sh
pnpm typecheck            # runs through turbo — clean
pnpm --filter @language-drill/lambda typecheck   # bypasses turbo — will hit 53 stale-dist errors unless db is rebuilt first
```

If you want to verify the lambda directly, do `pnpm --filter @language-drill/db build` first, or just trust the root-level `pnpm typecheck` (which is what CI runs).

## Verification

All commands run from the worktree root (`/Users/valentinanikitina/Seal/Dev/language-drill/.claude/worktrees/dependency-audit`).

- `pnpm install` — lockfile updated (drizzle-orm + drizzle-kit + @neondatabase/serverless and their transitives).
- `pnpm lint` — **green**, all 6 packages with lint scripts pass.
- `pnpm typecheck` — **green**, all 11 typecheck/build tasks pass.
- `pnpm test` — **477 tests across 39 files pass** (same totals as PR 1's baseline — no test count drift):
  - `@language-drill/shared` — 21 tests
  - `@language-drill/db` — 6 tests
  - `@language-drill/ai` — 31 tests
  - `@language-drill/api-client` — 75 tests
  - `@language-drill/lambda` — 55 tests
  - `@language-drill/web` — 289 tests

### Manual smoke recipe (per design.md §Manual Smoke Recipe step 3)

`pnpm dev` booted both API (port 3001) and web (port 3000) cleanly. Five exercise-list probes against `GET /exercises` returned HTTP 200 with valid rows from Neon, exercising drizzle 0.45.2 + neon 1.1.0 read paths end-to-end:

| Language | Difficulty | Result |
|---|---|---|
| es | A2 | HTTP 200, valid rows |
| en | B1 | HTTP 200, valid rows |
| de | A2 | HTTP 200, valid rows |
| tr | B1 | HTTP 200, valid rows |
| es | B1 | HTTP 200, valid rows |

Coverage: ES + EN + DE + TR × A2 + B1 — every supported language at the intermediate-plateau difficulties matches the product's primary use case (`CLAUDE.md` "Positioning"). All five probes hit the new drizzle/neon stack without errors.

## Migration evidence

Task 2.6 (run `pnpm db:migrate` against a fresh Neon branch) is **deferred to CI's `neon-migrate` job**. Per `.github/workflows/`, the PR pipeline creates an ephemeral Neon branch and runs migrations on it before the lint/typecheck/test gate. A successful CI run is the migration evidence required by R2.4.

- [x] CI `neon-migrate` job: green (32s) — https://github.com/nikolaivanv/language-drill/actions/runs/25141232211/job/73691342534

The task-2.6 checkbox in `.claude/specs/dependency-audit/tasks.md` flips to `[x]` once this is recorded.

## Pin guarantees + audit posture

Per task 2.8 — explicit per-PR checkpoint that R6 (pin guarantees) and the Security NFR are met before merge. All commands run from the worktree root.

### Pin verification (`pnpm list -r --depth=0 @types/node next zod typescript @hono/node-server`)

| Package | Required line | Resolved version(s) on this branch | PR-2 verdict |
|---|---|---|---|
| `@types/node` | 22.x | 22.19.17 (root) — every workspace inherits via `pnpm.overrides` | OK |
| `next` | 15.x | 15.5.15 (`apps/web`) | OK |
| `zod` | 3.x | 3.25.76 (`infra/lambda`, `packages/api-client`) | OK |
| `typescript` | 5.x | 5.9.3 (root + every workspace) | OK |
| `@hono/node-server` | 1.x | 1.19.14 (`infra/lambda`) | OK |

No drift onto 24.x/25.x `@types/node`, `next` 16, `zod` 4, `typescript` 6, or `@hono/node-server` 2 — the drizzle/neon major bumps did not pull any held-back package past its pin.

### `pnpm.overrides` byte-identical confirmation

The `pnpm` block at `package.json:28-32` on this branch:

```json
  "pnpm": {
    "overrides": {
      "@types/node": "^22.0.0"
    }
  }
```

`diff` of this block against `main` is empty for both raw text and canonical JSON (`json.dumps(..., sort_keys=True)`) — **byte-identical** to `main`. No new override entries were needed (R6.3): the drizzle/neon transitives did not force any held-back package past its pin.

### `pnpm audit --prod` posture

Production-only audit, this branch vs. `main` (`a0acc6d` — local main HEAD, same baseline used in PR-1's task 1.7; verified that no further `package.json`-touching commits have landed on `main` since PR 1 merged):

| Severity | `main` (a0acc6d) | This branch | Delta |
|---|---|---|---|
| critical | 0 | 0 | 0 (was already cleared by PR 1's Clerk bump) |
| **high** | **1** | **0** | **-1 (drizzle-orm SQL-injection GHSA-gpj5-g38j-94v9 cleared by 0.30 → 0.45.2)** |
| moderate | 3 | 1 | -2 (hono JSX SSR + uuid bounds-check transitive paths re-resolved through the new drizzle/neon dep tree) |
| low | 0 | 0 | 0 |

Branch advisory that remains:

- MODERATE `postcss` <8.5.10 — transitive via `next` 15.5.15 (held back per R6); will clear when Next bumps its pinned postcss or when the deferred Next 16 spec lands.

**Verdict: no regression.** PR-2 strictly improves security posture — the **last HIGH advisory on `main` is cleared** (drizzle-orm SQL-injection). Total advisories drop from 4 → 1. Merge is **not** blocked by the Security NFR.

### Requirement traceability

Satisfies R6.1, R6.2, R6.3, NFR Security.

## Deferred work

These items remain on the drift list and are owned by later PRs in this rollout:

- **PR 3** — `chore(deps): anthropic sdk` (`@anthropic-ai/sdk` 0.36.3 → 0.91.1)
- **PR 4** — `chore(deps): vitest stack` (`vitest` 1.6.1 → 4.1.5, `@vitejs/plugin-react` 4.7.0 → 6.0.1)
- **PR 5** — `chore(deps): eslint flat config` (`eslint` 8.57.1 → 9.x, `@typescript-eslint/*` 7.18.0 → 8.59.1, `.eslintrc*` → flat config)
- **Held back per R6 / strategic decisions:** `@types/node` 22.x (Lambda LTS, pinned via `pnpm.overrides`), `next` 15.x (defer to Next 16 spec), `zod` 3.x (defer to zod 4 spec), `typescript` 5.x (let TS 6 ecosystem settle), `@hono/node-server` 1.x (local-dev only, low ROI).

---

Closes the data-layer group of `.claude/specs/dependency-audit/`. Sequenced after PR 1 and before PR 3 per `design.md` §Components and §Architecture.
