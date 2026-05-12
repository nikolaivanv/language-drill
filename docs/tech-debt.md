# Tech Debt

A living log of known issues to address. Add new entries at the top; mark as resolved (don't delete) so we can grep history. Each entry: title, status, discovered date, scope, root cause, remediation, references.

---

## `@language-drill/shared` emits ESM with extensionless relative imports

- **Status:** open (worked around in PR #94)
- **Discovered:** 2026-05-12 (production deploy failed after PR #91 merged the streaming-annotate feature)
- **Scope:** `packages/shared/` — its tsconfig + every relative `export * from "./x"` / `import { y } from "./z"` inside `src/`
- **Severity:** medium (currently survives via bundler lenience + a CDK-side workaround; will resurface whenever a Node-strict consumer is added)

**Root cause:**
`packages/shared` compiles with `module` defaulting to ES2022 (target ES2022 → ESM output) but `package.json` has no `"type": "module"` and `main`/`types` point at plain `dist/index.js`/`dist/index.d.ts`. The compiled `dist/index.js` therefore contains ESM syntax with relative re-exports that omit the `.js` extension:

```js
export * from "./onboarding";
export * from "./read";
export * from "./tokenize";
export * from "./cors";
```

That layout is fine for the consumers we currently have — Next.js, esbuild (Lambda bundling), and tsx all resolve extensionless imports as a matter of convenience — but it violates the ESM spec, which requires explicit extensions on relative specifiers. Node's strict ESM resolver (the one ts-node hits via `require(esm)` when it loads the package from a CJS-compiled file) rejects them with `ERR_MODULE_NOT_FOUND: Cannot find module '...packages/shared/dist/onboarding'`.

**Verified:** reproduced on `main` locally with `pnpm --filter @language-drill/shared build && cd infra && pnpm cdk synth LanguageDrillStack`. The CI failure on commit `3b4d452` is the same trace. The first time this surfaced was during the streaming-annotate rollout — task 26b added `import { FALLBACK_ORIGINS } from "@language-drill/shared"` in `infra/lib/constructs/annotate-stream-lambda.ts`, which is the only Node-strict-ESM consumer in the tree. Every other consumer either bundles the source or uses tsx.

**Symptoms this causes:**
- Production deploy blocked between PRs #93 and #94 (ts-node, invoked by `cdk synth`, couldn't load `dist/index.js`).
- Latent — any future infra construct that imports a value from `@language-drill/shared` will re-trip the same failure unless it follows the relative-source-path workaround.
- Subtle blast radius: works in `pnpm dev`, in `pnpm test`, in Next.js build, in the Lambda esbuild bundle. Fails only at `cdk synth`/`cdk deploy`. So a regression won't show up in pre-push CI — only in the deploy job.

**Remediation options (pick one):**

1. **Add `.js` extensions to every relative import in `packages/shared/src/`** and enable `"verbatimModuleSyntax": true` (or rely on TypeScript 5.7+'s `rewriteRelativeImportExtensions`) so tsc preserves them in output.
   - Pros: smallest behavioral change for downstream; package becomes ESM-spec-correct; works for every consumer without workarounds.
   - Cons: touches every relative import in shared (counting `index.ts` re-exports plus internal cross-references — probably 10–20 lines). Has to be done atomically with a tsconfig change so `tsc` doesn't error on `.js` specifiers pointing at `.ts` sources.

2. **Switch `packages/shared` to CJS output** (add `"module": "commonjs"` to its tsconfig, optionally `"type": "commonjs"` to `package.json`).
   - Pros: extensionless requires work natively; no source-level churn.
   - Cons: Next.js's tree-shaking is materially better with ESM input; api-client and the web app would lose that. Probably regresses bundle size.

3. **Add an `exports` map to `packages/shared/package.json`** with both ESM (`.mjs` or `dist/index.js`-with-`type:module`) and CJS conditional exports. Build script emits both.
   - Pros: belt-and-braces; future consumers in either ecosystem just work.
   - Cons: heaviest change; requires dual emit and adjusting the build script.

Approach #1 is the recommended path: smallest patch, keeps everything ESM, and converts shared into a properly-spec'd ESM package without affecting bundle behavior.

**Acceptance criteria for the fix:**
- Revert the relative-source-path workaround in `infra/lib/constructs/annotate-stream-lambda.ts` (re-import via `@language-drill/shared`).
- Revert the `rootDir` removal in `infra/tsconfig.json`.
- `pnpm --filter @language-drill/shared build && cd infra && pnpm cdk synth LanguageDrillStack` succeeds (or fails only on missing runtime env vars).
- Full pre-push suite (`pnpm lint && pnpm typecheck && pnpm test`) green.
- Vercel preview build green (proves no Next.js regression).

**Why we can't ignore it:**
- The current state requires every infra consumer of shared to use the relative-source-path pattern — easy to forget, and grep-unfriendly compared to the package-name import.
- ts-node is the canonical "strict Node ESM" entry point used by CDK; we will keep adding constructs over time.
- The shared package is supposed to be the single source of truth for cross-workspace constants; making it inconvenient to consume from infra defeats that.

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing
**References:**
- PR #94 — the targeted CDK workaround that unblocked production deploy.
- `infra/lib/constructs/annotate-stream-lambda.ts:13–20` — the comment explaining why the relative-source path is used.
- `packages/shared/tsconfig.json` + `packages/shared/package.json` — the package-level settings to change.
- Node ESM resolver spec: https://nodejs.org/api/esm.html#mandatory-file-extensions
- TypeScript `rewriteRelativeImportExtensions`: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html

---

## Per-draft validation loop in `runOneCell` is strictly serial

- **Status:** open
- **Discovered:** 2026-05-12 (during the PR #71 DLQ-redrive observation)
- **Scope:** generation Lambda — `packages/db/src/generation/run-one-cell.ts:397-444`
- **Severity:** medium (correctness is fine; pipeline wall-clock + headroom are the cost)

**Root cause:**
`runOneCell` does one batched Claude call to generate ~50 drafts, then iterates the resulting array **sequentially** and calls `validateAndInsertWithRetry` per draft. That helper makes one full `validateDraft` Claude round-trip (`packages/ai/src/validate.ts:256`, `max_tokens: 1024`) for every draft before moving on. The dedup-conflict path can trigger up to `MAX_DEDUP_RETRIES = 3` extra validate+regenerate cycles on top.

Measured on the post-PR-#71 redrive (2026-05-12):
- Successful cells: `durationMs` 325–402 s for `inserted` 44–50.
- Per-draft cost: ~5–8 s average (one Claude validation round-trip).
- Generation call + DB inserts are small fractions of the total — the wall-clock is dominated by the serialized validate fan-out.

**Verified:** measurement source is the structured `cell succeeded` log lines in `/aws/lambda/LanguageDrillStack-GenerationLambdaWrapHandler1113-...` for jobIds completed during the redrive window starting 11:14 UTC.

**Symptoms this causes:**
- Pre-#71, cells with a couple of dedup retries tipped past the 600 s Lambda timeout, got silently killed, and DLQ'd after `maxReceiveCount: 3` redeliveries (34 of 43 today).
- Post-#71, headroom is 900 s — comfortable for now, but the failure mode is the same shape (linear in `count`). If we ever bump `MIN_PER_CELL` or generate longer cells, the same timeout cliff reappears.
- A daily batch of ~50 cells × ~6 min wall-clock at concurrency 3 takes ~100 min of Lambda time; parallelizing validation would shrink each cell to ~60–90 s and the batch to ~15–25 min.

**Remediation:**
Parallelize the validate fan-out with a small concurrency cap (start at 5–8 and tune against the Anthropic org-tier rate limits — Phase 4 reserved Lambda concurrency at 3 specifically to leave validator headroom). Sketch:

1. Split the per-draft loop into two phases:
   - **Phase A — validate in parallel.** `Promise.all(batch.drafts.map(p-limit(8)(validateDraft)))` to collect verdicts. Independent calls, no shared state.
   - **Phase B — insert+dedup sequentially** (or with a smaller cap). Keeps the dedup-retry coupling with the SQL unique-index intact, since that path needs to observe one conflict before regenerating the next draft.
2. Preserve cancellation: thread the existing `AbortSignal` through the `p-limit` wrapper so SIGINT (CLI) still aborts cleanly.
3. Preserve cost accounting: aggregate `combinedUsage` after Phase A resolves rather than incrementally; semantics unchanged.
4. Tests:
   - `run-one-cell.test.ts` already covers the serial path; add a case that asserts validate calls overlap in time (mock `validateDraft` to record start/end timestamps and assert at least two overlap).
   - Existing dedup-retry tests should still pass — Phase B keeps the sequential insert path.

**Why we can't ignore it:**
- Single biggest contributor to today's DLQ accumulation (PR #71 raised the ceiling but didn't fix the slope).
- Linear-in-`count` wall-clock means future curriculum growth (more grammar points × more vocab umbrellas) pushes us back toward the 900 s ceiling.
- The soft-deadline-with-audit-row patch (option b in the post-#71 plan) is far less valuable if the wall-clock fits comfortably under timeout; this should land first.

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing
**References:**
- PR #71 (`d3f3c48`) — Lambda timeout 600 → 900 s; surfaced this slope as the underlying issue.
- `packages/db/src/generation/run-one-cell.ts:397-444` — the loop.
- `packages/ai/src/validate.ts:256` — the Claude call paid 50× per cell.
- Anthropic Sonnet 4.6 org rate limits — gating factor on the concurrency cap; pull current value before tuning.

---

## ESLint v9 incompatibility breaks `pnpm lint`

- **Status:** resolved 2026-05-03 (during exercise-ui task 33)
- **Discovered:** 2026-05-01 (during exercise-ui task 1)
- **Scope:** repo-wide — `pnpm lint` from the root fails on `main`
- **Severity:** high (the pre-push gate documented in `CLAUDE.md` cannot run cleanly until this is fixed)

**Root cause:**
Next.js 16 deprecated the `next lint` command. The wrapper still passes ESLint v8 options that ESLint v9 has removed:
- `useEslintrc`
- `extensions`
- `resolvePluginsRelativeTo`
- `rulePaths`
- `ignorePath`
- `reportUnusedDisableDirectives`

This causes `pnpm --filter @language-drill/web lint` to fail with an `Invalid Options` error before any rules actually run.

**Verified:** the failure exists on a clean `main` (reproduced by stashing the in-flight exercise-ui changes and re-running `pnpm lint`). It is not introduced by any current spec work.

**Remediation:**
Run the official Next.js codemod to migrate from `next lint` to direct ESLint CLI invocation:

```bash
npx @next/codemod@canary next-lint-to-eslint-cli .
```

This will replace the `next lint` script in `apps/web/package.json` with an `eslint` invocation, generate a flat-config file (`eslint.config.mjs`) compatible with ESLint v9, and migrate any custom rules/plugins.

After running the codemod, verify:
- `pnpm --filter @language-drill/web lint` exits 0
- The flat config preserves the existing rule set (no rules silently dropped)
- `pnpm lint` from the repo root chains correctly through Turborepo

**Why we can't ignore it:**
- `CLAUDE.md` mandates `pnpm lint && pnpm typecheck && pnpm test` pass before every push
- Phase F (`exercise-ui`) and later phases add many new TSX files; without working lint, style/quality regressions will leak into PRs
- CI presumably has the same gate (verify in `.github/workflows/`)

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing
**References:**
- Next.js migration docs: https://nextjs.org/docs/app/api-reference/cli/next#next-lint
- ESLint v9 flat config: https://eslint.org/docs/latest/use/configure/configuration-files

**Resolution (2026-05-03):**
The codemod was run but only added `eslint-config-next` to root `package.json` — it didn't update `apps/web/package.json` because it found the existing repo-root flat config (`eslint.config.js`, installed by the dependency-audit rollout) and bailed out of generating a new one. Manual fix:
- Changed `apps/web/package.json` `lint` script from `next lint` to `eslint .` so it uses the root flat config directly.
- Added `**/next-env.d.ts` to the root `eslint.config.js` ignores (auto-generated Next.js types use a triple-slash reference that the strict TS rules flag).
- Cleaned up two trivial unused-var lints surfaced by the now-working pipeline (`EvaluationResult` import in `cloze-exercise.test.tsx`; destructured but unused `_exerciseType`/`_vocabActiveCount` props in `coach-rail.tsx` — kept on the `CoachRailProps` interface for the future tracker slot per design.md).

`eslint-config-next` was installed but not yet wired into the flat config. The current `@typescript-eslint/recommended` set is sufficient; if Next.js-specific rules (e.g. `@next/next/no-img-element`) are wanted, that's a follow-up.

`pnpm lint && pnpm typecheck && pnpm test` from repo root all pass. Pre-push gate restored.

---
