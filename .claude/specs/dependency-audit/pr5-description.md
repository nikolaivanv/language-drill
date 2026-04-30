# chore(deps): eslint flat config

## Summary

PR 5 of 5 in the rollout planned by `.claude/specs/dependency-audit/` — the final upgrade PR before the closeout (PR 6). Moves the lint stack off the EOL ESLint 8 line: `eslint` 8.57.1 → 9.39.4, `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` 7.18.0 → 8.59.1, plus a flat-config migration that collapses three legacy config files (`.eslintrc.base.js`, `.eslintrc.js`, `.eslintignore`) into a single root `eslint.config.js`. Brings ESLint into Node-supported territory and clears the carry-over deprecation warnings (ESLint 8 EOL, `@humanwhocodes/config-array`, `@humanwhocodes/object-schema`, `glob` 7, `inflight`, `rimraf` 3) that have been showing up in `pnpm install` output across the entire rollout.

Diff is the root `package.json`, `pnpm-lock.yaml` (net −159 lines), one new `eslint.config.js`, three deleted legacy config files, and this description. Zero source files migrated.

## Bumps in this PR

| Package | Workspace | Old → New | Notes |
|---|---|---|---|
| `eslint` | root devDep | `^8.0.0` → `^9.0.0` (resolved 9.39.4) | Major. ESLint 8 is EOL since 2024-10. v9 ships flat config as the default and removes the legacy `.eslintrc*` cascade. Also swaps `@humanwhocodes/config-array` + `@humanwhocodes/object-schema` for `@humanfs/*` + `@humanwhocodes/retry`, dropping the deprecated transitives carried by 8.x. ([changelog](https://github.com/eslint/eslint/releases)) |
| `@typescript-eslint/eslint-plugin` | root devDep | `^7.0.0` → `^8.59.1` | Major. v8 is the first line that natively supports flat config (no `FlatCompat` shim required) and pairs with ESLint 9. ([changelog](https://github.com/typescript-eslint/typescript-eslint/releases)) |
| `@typescript-eslint/parser` | root devDep | `^7.0.0` → `^8.59.1` | Companion to the plugin — version pin must match. |

No new helper packages added — no `@eslint/eslintrc`, no `@eslint/js`, no `globals`, no `typescript-eslint` umbrella. The legacy config only used `@typescript-eslint/recommended` plus two custom rule overrides, which port natively in flat config.

## Config migration (flat config)

- **Created:** `eslint.config.js` (CJS, root). Single source of truth for the whole monorepo. Ports `@typescript-eslint/recommended` rules (sourced from `tsPlugin.configs.recommended.rules` — same upstream object the legacy `extends: ['plugin:@typescript-eslint/recommended']` resolved to) plus the two custom rules:
  - `@typescript-eslint/no-explicit-any: 'error'`
  - `@typescript-eslint/no-unused-vars: 'error'`

  The top-level `{ ignores: ['**/dist/', '**/node_modules/', '**/.next/', '**/cdk.out/'] }` entry replaces both the legacy `ignorePatterns` block and the standalone `.eslintignore` file.

- **Deleted:** `.eslintrc.base.js`, `.eslintrc.js`, `.eslintignore`.

- **No `FlatCompat` shim.** typescript-eslint v8 ships native flat-config support, and the legacy base only used `@typescript-eslint/recommended` (no other plugins, presets, or extends chain). The migration is a direct port — every rule that was active before is active after, sourced from the same upstream object.

## `next lint` (apps/web)

Next 15.5's `next lint` recognized the root flat config out of the box:

- No `apps/web/eslint.config.mjs` workspace override.
- No `ESLINT_USE_FLAT_CONFIG=true` env var.
- No `eslint-config-next` dep added.

**Probe verification (5.4):** dropped `export const probe: any = 1;` into a workspace file, ran `pnpm lint` from `apps/web`, confirmed exit 1 with `@typescript-eslint/no-explicit-any` firing, deleted the probe, reran lint, confirmed exit 0. This is the empirical evidence that `@typescript-eslint/*` rules are actually applied through `next lint`'s flat-config wrapper.

## Carry-over deprecation warnings cleared by this PR

Cross-checked against the lockfile diff (`git diff bf59a5d HEAD -- pnpm-lock.yaml`):

| Warning / transitive | PR-4 baseline | PR-5 |
|---|---|---|
| `eslint@8.57.1` "no longer supported" | present | gone (now 9.39.4) |
| `@humanwhocodes/config-array@0.13.0` | present | gone (replaced by `@humanfs/*` chain) |
| `@humanwhocodes/object-schema@2.0.3` | present | gone |
| `glob@7.2.3` (deprecated) | present | gone |
| `inflight@1.0.6` (deprecated) | present | gone |
| `rimraf@3.0.2` (deprecated) | present | gone |
| `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader` | present | **still present** — pulled by `tsx` / `drizzle-kit`, not ESLint. Out of scope for this PR. |

`@humanwhocodes/module-importer@1.0.1` is still in the tree (pulled in by `@humanwhocodes/retry` and Babel chain) — not the deprecated one.

## Verification

All commands run from the worktree root (`/Users/valentinanikitina/Seal/Dev/language-drill/.claude/worktrees/dependency-audit`), with cache bypassed for the final pre-push gate.

- `pnpm install` — lockfile regenerated, **net −159 lines** (`+284 / −443`).
- `pnpm lint --force` — **green**, **0 ESLint errors / 0 warnings**, 6/6 lint-script workspaces, ~3.8s wall-clock.
- `pnpm typecheck` — **green**, 11/11 typecheck/build tasks pass, ~10.0s.
- `pnpm test` — **604 tests across 46 files pass** (some Turborepo cache hits since runtime deps unchanged), ~10.9s:
  - `@language-drill/shared` — 42 tests
  - `@language-drill/db` — 6 tests
  - `@language-drill/ai` — 62 tests
  - `@language-drill/api-client` — 150 tests
  - `@language-drill/lambda` — 55 tests
  - `@language-drill/web` — 289 tests

Test count is preserved exactly vs. PR 4 (604/46) — no tests dropped to silence migration noise.

## Rule equivalence vs `bf59a5d` (PR-4 merge)

The single load-bearing question for an ESLint major is "did any rule silently disappear during the migration?" Two independent checks confirm rule parity:

1. **Same source-of-truth for the rule set.** The new `eslint.config.js` builds its rule object via `...tsPlugin.configs.recommended.rules` — the exact same `tsPlugin.configs.recommended.rules` object that the legacy `extends: ['plugin:@typescript-eslint/recommended']` resolved to internally. Plus the two explicit custom overrides (`no-explicit-any: error`, `no-unused-vars: error`) are carried verbatim.
2. **Empirical probe (5.4).** Dropping `export const probe: any = 1;` into a TS file under `apps/web/src/` made `pnpm lint` exit 1 with the expected `@typescript-eslint/no-explicit-any` violation. Removing the probe restored exit 0. This proves `@typescript-eslint/*` rules are firing through both the root flat config and the `next lint` wrapper after the migration.

No rule was unportable. No replacement plugin was needed.

## Deferred items (not rule drops — wrapper warnings carrying over)

These are surfaced by `next lint` after the migration and are intentionally out of PR-5 scope (per R7 — one upgrade group per PR):

1. **`next lint` deprecation notice.** Next 16 will require migration to `eslint .` directly. Belongs in an eventual Next 16 upgrade spec, not this rollout.
2. **"Next.js plugin not detected in your ESLint configuration".** Adding `@next/eslint-plugin-next` would silence it but expands scope (new plugin, new rule set, no current rule loosening to compensate). Defer to the same follow-up.
3. **Multi-lockfile warning.** Worktree-specific — the parent repo's `pnpm-lock.yaml` is visible above this worktree's checkout. Not an ESLint issue and not present outside worktree workflows.

## Pin guarantees + audit posture

Per task 5.6 — explicit per-PR checkpoint that R6 (pin guarantees) and the Security NFR are met before merge. All commands run from the worktree root.

### Pin verification (`pnpm list -r --depth=0 @types/node next zod typescript @hono/node-server`)

| Package | Required line | Resolved on this branch | Verdict |
|---|---|---|---|
| `@types/node` | 22.x | 22.19.17 (root + every workspace via `pnpm.overrides`) | OK |
| `next` | 15.x | 15.5.15 (`apps/web`) | OK |
| `zod` | 3.x | 3.25.76 (`infra/lambda`, `packages/api-client`) | OK |
| `typescript` | 5.x | 5.9.3 (root + every workspace) | OK |
| `@hono/node-server` | 1.x | 1.19.14 (`infra/lambda`) | OK |

The ESLint flat-config migration touched only root devDeps — none of the held-back packages moved. None of `@types/node` 24.x/25.x, `next` 16, `zod` 4, `typescript` 6, or `@hono/node-server` 2 appears anywhere in the resolved tree.

### `pnpm.overrides` byte-identical confirmation

The `pnpm` block at `package.json` on this branch:

```json
  "pnpm": {
    "overrides": {
      "@types/node": "^22.0.0"
    }
  }
```

`diff` of this block against `bf59a5d` (PR-4 merge — the comparison baseline for PR 5) is **empty for both raw text and canonical JSON** (`json.dumps(..., sort_keys=True)`):

```
$ git show bf59a5d:package.json | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin).get('pnpm',{}), indent=2, sort_keys=True))"
{
  "overrides": {
    "@types/node": "^22.0.0"
  }
}
$ cat package.json | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin).get('pnpm',{}), indent=2, sort_keys=True))"
{
  "overrides": {
    "@types/node": "^22.0.0"
  }
}
```

The ESLint 9 + typescript-eslint 8 upgrade did not require any new override entries — confirming R6.3 was not triggered. (The new dep tree resolved cleanly with the existing single `@types/node` override.)

### `pnpm audit --prod` posture

Production-only audit, this branch vs. `bf59a5d` (PR-4 merge — the comparison baseline for PR 5; verified that no `package.json`-touching commits have landed since via `git log --since="2026-04-30 20:40:32 +0300" --stat -- "*package.json"` returning empty). Baseline re-run on a fresh clone of `bf59a5d` (`/tmp/pr4-audit`) to confirm.

| Severity | `bf59a5d` (PR-4 merge) | This branch | Delta |
|---|---|---|---|
| critical | 0 | 0 | 0 |
| high | 0 | 0 | 0 |
| moderate | 1 | 1 | 0 |
| low | 0 | 0 | 0 |

Branch advisory that remains:

- MODERATE `postcss` <8.5.10 — transitive via `next` 15.5.15 (held back per R6); will clear when Next bumps its pinned `postcss` or when the deferred Next 16 spec lands. **Same single advisory documented by PRs 2, 3, and 4.** PR 5 is dev-deps + config-shape only (root devDeps `eslint`, `@typescript-eslint/*`, plus a flat-config file move) — by construction it cannot affect the prod-dep advisory tree. The audit numbers being flat is the expected outcome, not a coincidence.

**Verdict: no regression.** Audit posture is byte-identical to `bf59a5d`. Merge is **not** blocked by the Security NFR.

### Requirement traceability

Satisfies R6.1, R6.2, R6.3, NFR Security.

## Rollout closeout

With PR 5 merged, all five dependency-audit upgrade PRs are landed:

1. PR 1 — `chore(deps): patch bundle`
2. PR 2 — `chore(deps): drizzle + neon driver`
3. PR 3 — `chore(deps): anthropic SDK`
4. PR 4 — `chore(deps): vitest stack`
5. **PR 5 — `chore(deps): eslint flat config`** (this PR)

The held-back packages remain pinned per R6 — these are strategic decisions, not drift, and each warrants a dedicated future spec:

- `@types/node` 22.x — Lambda LTS, pinned via `pnpm.overrides`.
- `next` 15.x — defer to the Next 16 spec.
- `zod` 3.x — defer to the zod 4 spec.
- `typescript` 5.x — let the TS 6 ecosystem settle.
- `@hono/node-server` 1.x — local-dev only, low ROI.

The PR-6 closeout task (6.1) stamps `Status: rolled out YYYY-MM-DD` on `docs/dependency-audit.md` and marks the rollout complete.

---

Closes the lint-stack group of `.claude/specs/dependency-audit/`. Sequenced after PR 4 per `design.md` §Components and §Architecture.
