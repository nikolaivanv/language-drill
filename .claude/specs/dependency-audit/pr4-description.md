# chore(deps): vitest stack

## Summary

PR 4 of 5 in the rollout planned by `.claude/specs/dependency-audit/`. Bumps `vitest` 1.6.x → 4.1.5 across all six workspaces with test suites and `@vitejs/plugin-react` 4.x → 6.0.1 in `apps/web` and `packages/api-client`, plus a new direct `vite: ^8.0.10` pin in those two workspaces (required because plugin-react 6 strictly peers on vite 8 only). Brings the test runner onto the ESM-native vite Node API and sheds the deprecated CJS Vite Node API warning that has been showing up in test output since the spec rollout began. Wall-clock is essentially flat (+1.6% vs the PR-1 baseline — well under the 25% NFR Performance ceiling).

Diff is six `package.json` files, `pnpm-lock.yaml`, one source migration in `packages/api-client/src/hooks/usePreferences.test.ts` (mock-type generic-form rename), and this description. Zero `vitest.config.ts` files needed migration.

## Bumps in this PR

| Package | Workspace | Old → New | Notes |
|---|---|---|---|
| `vitest` | `apps/web`, `infra/lambda`, `packages/ai`, `packages/api-client`, `packages/db`, `packages/shared` | 1.x → 4.1.5 | Major (×3 boundary crossings: v2, v3, v4). v4 collapses `tinypool` / `tinyspy` / `vite-node` into its own bundle and drops the deprecated CJS Vite Node API. ([changelog](https://github.com/vitest-dev/vitest/releases)) |
| `@vitejs/plugin-react` | `apps/web`, `packages/api-client` | 4.x → 6.0.1 | Major. Strict peer on `vite@^8` (no longer accepts vite 5/6/7 like plugin-react 4 did). ([changelog](https://github.com/vitejs/vite-plugin-react/releases)) |
| `vite` (NEW direct devDep) | `apps/web`, `packages/api-client` | — → 8.0.10 | New explicit pin. Plugin-react 6's strict `vite@^8` peer combined with vitest 4's looser `vite@^6 \|\| ^7 \|\| ^8` peer meant pnpm's auto-peer-resolution kept the workspace on vite 5 transitively (the higher version that satisfied both). The new direct vite dep is the minimum addition required to make plugin-react 6 + vitest 4 actually function — not a "bump" per se, but a new pin needed to stop pnpm picking a stale peer. |

## Lockfile churn

- **Net −676 lines** (`+398 / −1074`) — `git diff origin/main --stat -- pnpm-lock.yaml`.
- Cumulative across the three lockfile-touching tasks (4.1 vitest, 4.2 plugin-react, 4.3 vite-direct): roughly −1.3K lines net at intermediate snapshots before stabilising at −676 net once the dust settled.
- Tree changes:
  - vitest 4 collapses `tinypool`, `tinyspy`, `vite-node` into its own bundle.
  - vite 5's `rollup` 4-prior subset and `esbuild` 0.21 group dedupe to vite 8's tighter tree.
  - plugin-react 4's transitives (the older babel/refresh chain) shed.
- **Concrete winner:** the deprecated CJS Vite Node API warning is gone from `pnpm test` output.

This is the second upgrade in the rollout (after PR 3) where the lockfile gets _smaller_ at a major boundary.

## Source migration

Only **one source file** was modified across the entire workspace:

- `packages/api-client/src/hooks/usePreferences.test.ts` — 10 mock-type generic-form sites renamed.

vitest 3+ collapsed the legacy two-tuple generic forms `Mock<TArgs, TReturn>` and `vi.fn<TArgs, TReturn>()` into the function-type form `Mock<(...) => R>` / `vi.fn<(...) => R>()`. We adopted the cleanest expression of the new form — `Mock<AuthenticatedFetch>` and `vi.fn<AuthenticatedFetch>()` — reusing the existing `AuthenticatedFetch` type alias instead of inlining arrow types at every call site.

**No `vitest.config.ts` files needed migration.** Every config in this repo (`apps/web/vitest.config.ts`, `infra/lambda/vitest.config.ts`, `packages/ai/vitest.config.ts`, `packages/shared/vitest.config.ts`) uses only the stable `defineConfig({ plugins, test: { environment, globals, setupFiles, alias } })` surface, which was preserved across vitest v2/v3/v4. `packages/db` and `packages/api-client` rely on vitest defaults — also unchanged.

`packages/db/src/**`, `packages/ai/src/**`, `packages/shared/src/**`, `infra/lambda/src/**`, `apps/web/src/**` are all untouched. The vitest 4 ESM-native Vite Node migration was a pure runner-internals change for this codebase.

## Verification

All commands run from the worktree root (`/Users/valentinanikitina/Seal/Dev/language-drill/.claude/worktrees/dependency-audit`).

- `pnpm install` — lockfile regenerated, net −676 lines.
- `pnpm lint` — **green**, 6/6 packages with lint scripts pass.
- `pnpm typecheck` — **green**, 11/11 typecheck/build tasks pass.
- `pnpm test` — **604 tests across 46 files pass**:
  - `@language-drill/shared` — 42 tests
  - `@language-drill/db` — 6 tests
  - `@language-drill/ai` — 62 tests
  - `@language-drill/api-client` — 150 tests (the workspace whose test file was migrated)
  - `@language-drill/lambda` — 55 tests
  - `@language-drill/web` — 289 tests

The single migrated file (`usePreferences.test.ts`) is exercised by the api-client suite and stayed green after the generic-form rewrite.

### Performance NFR

The 25%-regression ceiling from R-NFR Performance is the load-bearing check for this PR.

| Measurement | Wall-clock |
|---|---|
| Baseline (PR 1 task 1.6 mean) | **~13.5s** |
| 1.25× ceiling (R-NFR Performance) | ~16.9s |
| PR 4 Run A | 13.195s |
| PR 4 Run B | 14.238s |
| **PR 4 mean** | **13.717s (+1.6% vs baseline)** |

**Verdict: NFR satisfied by a wide margin.** The vitest 4 + plugin-react 6 + vite 8 stack does not impose a measurable wall-clock penalty on this workspace's suite. We are about 3.2 seconds (~19 percentage points) inside the ceiling.

## Pin guarantees + audit posture

Per task 4.6 — explicit per-PR checkpoint that R6 (pin guarantees) and the Security NFR are met before merge. All commands run from the worktree root.

### Pin verification (`pnpm list -r --depth=0 @types/node next zod typescript @hono/node-server`)

| Package | Required line | Resolved on this branch | Verdict |
|---|---|---|---|
| `@types/node` | 22.x | 22.19.17 (root + every workspace via `pnpm.overrides`) | OK |
| `next` | 15.x | 15.5.15 (`apps/web`) | OK |
| `zod` | 3.x | 3.25.76 (`infra/lambda`, `packages/api-client`) | OK |
| `typescript` | 5.x | 5.9.3 (root + every workspace) | OK |
| `@hono/node-server` | 1.x | 1.19.14 (`infra/lambda`) | OK |

The vitest stack upgrade did not pull any held-back package past its pin. None of `@types/node` 24.x/25.x, `next` 16, `zod` 4, `typescript` 6, or `@hono/node-server` 2 appears in the resolved tree. The new direct `vite: ^8` pin is in the **vite** package, not any of the held-back packages — orthogonal to R6.1 / R6.2.

### `pnpm.overrides` byte-identical confirmation

The `pnpm` block at `package.json` on this branch:

```json
  "pnpm": {
    "overrides": {
      "@types/node": "^22.0.0"
    }
  }
```

`diff` of this block against `origin/main` (`6f4f5df` — PR-3 merge) is **empty for both raw text and canonical JSON** (`json.dumps(..., sort_keys=True)`). The vitest stack upgrade did not require any new override entries — confirming R6.3 was not triggered. (vite 8, vitest 4, and plugin-react 6 all resolved cleanly with the existing single `@types/node` override.)

### `pnpm audit --prod` posture

Production-only audit, this branch vs. `origin/main` (`6f4f5df` — PR-3 merge commit; verified that no `package.json`-touching commits have landed on `origin/main` since via `git log origin/main --since="2026-04-30 04:26:35 +0300" --stat -- "*package.json"` returning empty). Baseline re-run on a fresh clone of `origin/main` to confirm.

| Severity | `origin/main` (`6f4f5df`) | This branch | Delta |
|---|---|---|---|
| critical | 0 | 0 | 0 |
| high | 0 | 0 | 0 |
| moderate | 1 | 1 | 0 |
| low | 0 | 0 | 0 |

Branch advisory that remains:

- MODERATE `postcss` <8.5.10 — transitive via `next` 15.5.15 (held back per R6); will clear when Next bumps its pinned postcss or when the deferred Next 16 spec lands. **Same single advisory PR-2 and PR-3 documented.** PR 4 is dev-deps only (vitest, plugin-react, vite — all `devDependencies`), so by construction it cannot affect the prod-dep advisory tree. The audit numbers being flat is the expected outcome, not a coincidence.

**Verdict: no regression.** Audit posture is byte-identical to `origin/main`. Merge is **not** blocked by the Security NFR.

### Requirement traceability

Satisfies R6.1, R6.2, R6.3, NFR Security.

## Deferred work

These items remain on the drift list and are owned by later PRs in this rollout:

- **PR 5** — `chore(deps): eslint flat config` (`eslint` 8.57.1 → 9.x, `@typescript-eslint/*` 7.18.0 → 8.59.1, `.eslintrc*` → flat config)
- **PR 6** — `chore(deps): mark audit rolled out` (closeout: stamp `Status: rolled out YYYY-MM-DD` on `docs/dependency-audit.md`)
- **Held back per R6 / strategic decisions:** `@types/node` 22.x (Lambda LTS, pinned via `pnpm.overrides`), `next` 15.x (defer to Next 16 spec), `zod` 3.x (defer to zod 4 spec), `typescript` 5.x (let TS 6 ecosystem settle), `@hono/node-server` 1.x (local-dev only, low ROI).

---

Closes the test-runner group of `.claude/specs/dependency-audit/`. Sequenced after PR 3 and before PR 5 per `design.md` §Components and §Architecture.
