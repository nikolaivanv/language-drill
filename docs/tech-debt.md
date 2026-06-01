# Tech Debt

A living log of known issues to address. Add new entries at the top; mark as resolved (don't delete) so we can grep history. Each entry: title, status, discovered date, scope, root cause, remediation, references.

---

## `rejection_reason_counts` / `flagged_reasons` mix canonical tags with free-form model prose (no canonical reason code)

- **Status:** open
- **Discovered:** 2026-06-01 (analysing the daily scheduled TR generation run — `generation_jobs.rejection_reason_counts` contained a 200-char paragraph as a single map key)
- **Scope:** `packages/db/src/generation/routing.ts:49-129` (where reasons are assembled), `packages/ai/src/validate.ts:96-145` (`ValidationResult.flaggedReasons` / `culturalIssues` — free-form `string[]`), `packages/ai/src/validation-prompts.ts:108-119` (prompt instructs free-text reasons), `packages/db/src/generation/run-one-cell.ts:410,548-556,599-617` (the `rejection_reason_counts` frequency map), `packages/db/src/generation/validate-and-insert.ts:440-443` (`exercises.flagged_reasons` persist), `packages/db/src/generation/deterministic-checks.ts:39-77` (Turkish reason strings that interpolate values)
- **Severity:** medium — no correctness or runtime risk, but it corrupts the exact analytics signal `rejection_reason_counts` was added to provide (migration `0012`), so the planned data-gated validator→generator repair loop can't aggregate over it

**Root cause:**
`routeValidationResult()` builds the reason arrays from two incompatible sources and concatenates them:

1. **Canonical tags** — a fixed, hand-written set of strings emitted on deterministic predicates: `'low quality score (<0.5)'`, `'context spoils answer'` (rejected branch); `'low quality score (<0.7)'`, `'ambiguous'`, `'level mismatch'`, `'grammar point mismatch'` (flagged branch). Plus the synthetic `'parser failure (retry exhausted)'` / `'validator parse failure (malformed response)'` (`validate-and-insert.ts:170,180`).
2. **Free-form model prose** — the validator's `result.culturalIssues[]` and `result.flaggedReasons[]`, which the tool schema and prompt explicitly define as free-text (`validate.ts:96-101`: *"Free-text descriptions…"*; `validation-prompts.ts:118`: *"Add anything that future-you would want to see when reviewing manually"*). These are unbounded English sentences with no canonical form.
3. **Value-interpolated deterministic strings** — `deterministic-checks.ts` emits e.g. `'wrong vowel-harmony allomorph (deterministic): expected <X>, got <Y>'`, so even the deterministic path produces a distinct key per token.

All three flow into the same array, which `run-one-cell.ts` folds into `rejectionReasonCounts[reason]++` — i.e. the **reason string is the map key**. There is no canonical reason enum anywhere in the codebase. So every unique paragraph becomes its own bucket with count 1, and the value-interpolated strings never collide either.

**Evidence (2026-06-01 prod scheduled run, TR A1/A2, 56 jobs):**
- `rejection_reason_counts` aggregated across the run: `low quality score (<0.5)` → 64, `context spoils answer` → 34, and a single bucket `The reference translation uses 'Ulan' as the equivalent of 'Hey', but 'Ulan' is a coarse, potentially offensive interjection in Turkish … [200+ chars]` → 1.
- `exercises.flagged_reasons` (JSON arrays) the same day mixed canonical tags — `low quality score (<0.7)` (153), `ambiguous` (104), `level mismatch` (89), `grammar point mismatch` (6) — with multi-sentence model explanations stored as sibling array elements.

The canonical tags aggregate cleanly; everything else is noise that defeats `GROUP BY reason`.

**Remediation:**
Separate the canonical reason **code** from the free-text **detail**:

1. **Introduce a canonical reason enum** (e.g. `packages/shared/src/generation-reasons.ts` exporting a `RejectionReasonCode` / `FlagReasonCode` union) covering the `routing.ts` tags, the parser/validator-failure synthetics, and a *category* for each deterministic check (`vowel-harmony-allomorph`, `malformed-surface-form`) and for validator free-text (`cultural-issue`, `validator-note`) — **without** interpolated values.
2. **Carry reasons as `{ code, detail? }`** out of `routeValidationResult()` / the deterministic checks. The `code` is enum-constrained; `detail` holds the free-form prose and interpolated values.
3. **Key the frequency map on `code` only** in `run-one-cell.ts` — so `rejection_reason_counts` has bounded cardinality and aggregates across cells and days.
4. **Keep `exercises.flagged_reasons` human-readable** for the manual review UI, but store it as `{ code, detail }[]` (or a `codes: string[]` + `notes: string[]` split) so dashboards filter on codes while reviewers still see the prose.
5. Backfill is optional — historical rows can stay as-is (the entry documents the format change); new runs get clean codes.

**Acceptance criteria for the fix:**
- A canonical reason-code constant exists and is the single source of truth; `routing.ts`, `deterministic-checks.ts`, and `validate-and-insert.ts` reference it instead of inline string literals.
- `generation_jobs.rejection_reason_counts` keys are drawn exclusively from that enum (assert in `run-one-cell.test.ts` that no map key contains a colon-interpolated value or a sentence-length string).
- Free-form validator prose is still retained per exercise (in `detail` / `notes`), so manual review loses no context.
- `SELECT reason, SUM(...) FROM generation_jobs, LATERAL jsonb_each_text(rejection_reason_counts) GROUP BY reason` on a post-fix run returns a bounded, stable set of rows.

**Why we can't ignore it:**
- Migration `0012` added `rejection_reason_counts` specifically to gate a validator→generator repair loop on rejection-reason frequencies (see `project_rejection_reason_logging`). Unbounded, per-row-unique keys make that aggregation meaningless — the feature is currently collecting data it can't use.
- Key cardinality grows without bound (one new bucket per unique model sentence / per interpolated token), so any dashboard or `GROUP BY` over these columns degrades over time rather than converging.
- It silently understates the real top reasons: 34 genuine `context spoils answer` rejections are easy to miss next to dozens of one-off prose buckets.

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing
**References:**
- `packages/db/migrations/0012_add_rejection_reason_counts_to_generation_jobs.sql` — the column this debt undermines.
- `packages/db/src/generation/routing.ts:49-129` — canonical tags + free-form concatenation.
- `packages/ai/src/validate.ts:96-145` — `ValidationResult` free-text reason arrays.
- `packages/ai/src/validation-prompts.ts:108-119` — prompt instructing free-text reasons.
- `packages/db/src/generation/run-one-cell.ts:548-556` — the `reason`-as-key fold.
- `packages/db/src/generation/deterministic-checks.ts:39-77` — value-interpolated reason strings.

---

## No generation-quality eval harness (`pnpm eval` only covers the evaluation prompt)

- **Status:** open
- **Discovered:** 2026-05-30 (post-merge of PR #227, generation-quality-improvements — the spec named `pnpm eval` as the pre-merge gate for its generation-prompt guardrails; on inspection the tool can't do that)
- **Scope:** `packages/ai/scripts/eval-run.ts` (+ `eval-export.ts`); the `pnpm eval` / `pnpm eval:export` root scripts
- **Severity:** medium — no correctness risk, but generation-prompt PRs ship without a quantitative pre-merge quality signal, and a spec/runbook actively points operators at a gate that returns zero signal (and spends real Anthropic budget doing so)

**Root cause:**
`eval-run.ts` resolves `--candidate` to a prompt body and feeds it to `evaluateAnswer` as a `systemPromptOverride`, then scores the result against captured *evaluation* baselines (dataset items are `EvaluateAnswerInput` — exercise + user answer, exported from `user_exercise_history`). It never imports or invokes the generation prompt builders (`buildGenerationSystemPrompt` / `buildGenerationUserPrompt`) or the validator. So it measures the **answer-evaluation** prompt only. Pointing it at a generation-prompt change exercises a prompt that change doesn't touch — the diff is noise, and every item still bills the Anthropic key.

The `generation-quality-improvements` design/requirements (Testing Strategy → "`pnpm eval` (manual, pre-merge): run the new generation prompt against a Langfuse dataset … This is the gate for the model-judgment guardrails") assumed a capability that does not exist. Treat any doc that calls `pnpm eval` a generation gate as a documentation bug until the harness below lands.

**Interim validation path (what PR #227 actually used):**
1. Unit tests pin the prompt text and the byte-parity / Anthropic cache-prefix contract.
2. After merge + `pnpm push-prompts` (the runtime serves the live Langfuse body; the in-repo constant is only the fallback), the `GENERATION_PROMPT_VERSION` bump clears prompt-version suppression so cells regenerate against the new body on the next scheduled run.
3. **Validate observationally on the post-merge run** by comparing `generation_jobs.rejection_reason_counts` and the flagged-tag distribution against the prior baseline (for #227: the 2026-05-30 TR run, 35.6% approved). This is the design's stated success metric — it is *post-merge and observational*, not a pre-merge gate.

**Remediation — a real generation eval (`eval-gen`):**
1. **Dataset of cells, not answers.** A `(language, cefrLevel, exerciseType, grammarPointKey)` list — exported from `generation_jobs` (over-sampling failure-prone cells) or hand-curated. Distinct from the `eval:export` answer-submission datasets.
2. **OLD-vs-NEW runner.** For each cell, build the system+user prompt via `buildGenerationSystemPrompt` / `buildGenerationUserPrompt` for both prompt versions, generate N drafts each, then score every draft with the existing **validator** (`validate-system-prompt` via `validateDraft`).
3. **Diff that matters for generation.** Approval rate, `rejection_reason` distribution, and flag-tag distribution — candidate vs baseline — rather than the per-dimension score deltas `eval-run.ts` computes for evaluation.
4. **Reuse the guard rails** from `eval-run.ts`: `LANGFUSE_ENV=prod` requires `--allow-prod`, and add a `--max-cost-usd` cap (it spends Anthropic budget per draft, ~N× more than answer-eval).

**Acceptance criteria for the fix:**
- A `pnpm eval:gen` (or equivalent) script that, given a cell dataset and two prompt sources, reports approval-rate and rejection-reason/flag-tag deltas between them, writing a JSON summary like `eval-run.ts` does.
- The `generation-quality-improvements` design/requirements (and any future spec) reference *this* script — not `pnpm eval` — as the generation gate.
- A unit test exercising the runner with stubbed generate+validate calls (mirroring `eval-run.test.ts`'s injectable-executor pattern).

**Why we can't ignore it:**
- Generation-prompt changes are exactly where regressions are expensive (a bad prompt re-sweeps the pool at real cost — the #227 baseline run was ~$30.80) and where unit tests are weakest (they pin wording, not model behavior).
- The current docs send the next operator to spend budget on a no-signal run; that's a foot-gun, not just a missing feature.

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing
**References:**
- PR #227 — generation-quality-improvements (surfaced the gap during post-merge).
- `.claude/specs/generation-quality-improvements/design.md` Testing Strategy + `requirements.md` NFR Performance/Cost — the mistaken "`pnpm eval` is the generation gate" assumption.
- `packages/ai/scripts/eval-run.ts` — the evaluation-only harness to mirror.
- `packages/ai/src/generation-prompts.ts` (`buildGenerationSystemPrompt`) + `packages/ai/src/validate.ts` (`validateDraft`) — the builders/validator a generation eval would drive.

---

## Langfuse `validate` traces missing `exerciseId` metadata

- **Status:** open (Phase 1 design accepted the gap; verified live in prod 2026-05-15)
- **Discovered:** 2026-05-15 (Task 24 post-deploy verification — observed validate trace with `feature/jobId/cellKey/promptVersion/env` but no `exerciseId`)
- **Scope:** `packages/ai/src/observability.ts` (Proxy ALS read), `infra/lambda/src/generation/handler.ts` (single outer `withLlmTrace` scope), `packages/db/src/generation/run-one-cell.ts` (where individual validate calls are dispatched)
- **Severity:** low — none of the five Phase-1 dashboards (Req 9 AC 1–5) need it; per-cell rejection rate aggregates by `cellKey`, which IS present on every validate trace

**Root cause:**
The generation Lambda enters `withLlmTrace` once per SQS record with the *shared* metadata (`jobId`, `cellKey`, `language`, `cefrLevel`, `exerciseType`). Inside that single ALS scope, `runOneCell` dispatches N `generate` Claude calls *and* 1..M `validate` Claude calls. The Proxy reads ALS at call time and swaps `feature` per call via `TOOL_NAME_TO_FEATURE` — that's why validate traces correctly inherit `jobId`/`cellKey` and get `feature='validate'`. But ALS doesn't know which specific draft is being validated, because that information lives inside `run-one-cell.ts` (in `packages/db`), which the Phase-1 spec deliberately kept observability-free for layering reasons (`.claude/specs/langfuse-implementation-phase-1/design.md §2c` — "Why a single outer scope, not nested").

**Requirements gap:** Req 2 AC 4 stated `validate` traces SHALL carry `exerciseId` (the draft id under validation). The design accepted partial coverage because Req 9 AC 4's dashboard math works on `cellKey` aggregation, not per-draft pairing.

**Remediation (two reasonable options):**

1. **Nested `withLlmTrace` inside the validation loop.** Modify `packages/db/src/generation/run-one-cell.ts` to import `withLlmTrace` from `@language-drill/ai` and open a nested scope around each `validateDraft(...)` call carrying `{ ...inheritedCtx, exerciseId: draft.id }`. ALS scopes nest cleanly — the inner store shadows the outer for the duration of the call. **Cost:** breaks the "packages/db observability-free" layering rule. Honest about it because run-one-cell already orchestrates LLM calls — adding trace context is in scope for an orchestrator.
2. **Proxy-side extraction.** Have the Proxy parse the request's tool input on `feature='validate'` to find a draft identifier (e.g. `draft.id` or a stable hash of the draft payload). Keeps `packages/db` clean. **Cost:** fragile — the validation prompt's input shape isn't a stable API; any prompt edit could silently break the extraction without test coverage catching it.

Recommended: **option 1**, despite the layering violation. The "no LLM observability in packages/db" rule made sense when only `packages/ai` issued Claude calls; once `run-one-cell` became the orchestrator, that rule stopped pulling its weight. Move the per-validate-call trace scope into the orchestrator and update the relevant tests.

**Acceptance criteria for the fix:**
- Every Langfuse trace with `feature='validate'` from the generation pipeline carries `metadata.exerciseId === <the draft row id under validation>`.
- `packages/db/src/generation/run-one-cell.test.ts` asserts the nested `withLlmTrace` scope is opened per draft (mock the symbol — same pattern used in `infra/lambda/src/generation/handler.test.ts`).
- A retry of the same draft (validation failed, regenerate-and-revalidate) produces a *new* validate trace with the *same* `exerciseId` — proves the pairing is stable across retries.
- Dashboard: pin a "per-draft validation outcome" view filtered to `feature='validate'`, grouped by `metadata.exerciseId`, showing the eventual approve/reject status. This is a Phase-2 nice-to-have, not a Phase-1 blocker.

**Why we can't ignore it forever:**
- Debugging "this exercise has weird feedback" against a generation job currently requires landing on the draft via `cellKey` then scanning every validate trace in that cell for the matching tool input. With `exerciseId` it's a one-click filter.
- The Phase-1 spec acknowledged this gap explicitly in `requirements.md` Req 2 AC 4 — closing the loop is a contract-completeness fix, not a feature add.

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing (good first-issue candidate for whoever picks up Phase 2 observability work)
**References:**
- `.claude/specs/langfuse-implementation-phase-1/requirements.md` Req 2 AC 4
- `.claude/specs/langfuse-implementation-phase-1/design.md §2c` (the deliberate-deferral note)
- `packages/ai/src/observability.ts` — `TOOL_NAME_TO_FEATURE` map shows how feature-switching already happens without per-call ALS edits
- `packages/db/src/generation/run-one-cell.ts` — the orchestrator that would host the nested scope

---

## Annotate-stream Function URL CORS allows all origins

- **Status:** open (worked around in PR #97 — set `allowedOrigins: ["*"]`)
- **See also:** [`aws-lambda-gotchas.md`](./aws-lambda-gotchas.md) §1 — the permanent reference for Function URL CORS schema quirks.
- **Discovered:** 2026-05-12 (production deploy after PR #95 — CloudFormation rejected `https://*.vercel.app` with `isn't a valid origin`)
- **Scope:** `infra/lib/constructs/annotate-stream-lambda.ts` Function URL CORS
- **Severity:** low (JWT verification + daily rate-limit are the real security boundary; browser CORS is a politeness filter, not authorization)

**Root cause:**
AWS Lambda Function URL CORS uses a different (more restrictive) schema than API Gateway HTTP API CORS. Function URL `AllowOrigins` accepts only:
- Full URLs (`https://www.example.com`)
- `https://*` (any HTTPS origin)
- `*` (any origin)

It does **not** accept subdomain wildcards like `https://*.vercel.app` — which is exactly what we want for Vercel preview deploys. API Gateway accepts them; Function URL doesn't. The original construct copied the API-Gateway-style list verbatim.

**Verified:** CloudFormation returned `https://*.vercel.app isn't a valid origin. An origin must be in a valid URL format. For example: https://www.example.com, https://*, or the wildcard character (*).` on `AWS::Lambda::Url` resource creation. Local `cdk synth` doesn't catch this — schema validation only fires server-side during resource creation, after `synth` and asset publish have succeeded.

**Current workaround:** `allowedOrigins: ["*"]`. Means any origin can make POST requests to the Function URL. The JWT auth still gates access — only authenticated users' tokens work — but the surface area is technically wider than the API Gateway endpoints (which retain the regex-matched allow-list via Hono middleware).

**Remediation:**
Move CORS enforcement into the streaming handler, matching the pattern already in `infra/lambda/src/index.ts:25` (`matchOrigin`):

1. **Promote `matchOrigin` to `packages/shared/src/cors.ts`** so both Lambdas import it from one place (alongside `FALLBACK_ORIGINS`).
2. **Update the streaming handler's SSE writer (`infra/lambda/src/annotate-stream/sse.ts`)** to:
   - Accept the request's `Origin` header.
   - Pass it through `matchOrigin`.
   - Emit `Access-Control-Allow-Origin: <matched-origin-or-omitted>` and `Access-Control-Allow-Credentials: true` (if needed) on every response branch: `openSse()`, `errorJson()`, and `cors200()`.
3. **Remove the `cors` config from the Function URL** in the construct. With in-handler CORS the platform CORS layer is redundant.
4. **Tests**: extend `sse.test.ts` and `handler.test.ts` with origin-echo cases (Vercel preview, prod hostname, unauthorized origin).

Important: the main API Lambda's CORS lives in Hono middleware. The streaming Lambda doesn't use Hono. So the new code is a thin handler-level adapter, not a Hono middleware reuse.

**Acceptance criteria for the fix:**
- Revert `allowedOrigins: ["*"]` in `infra/lib/constructs/annotate-stream-lambda.ts` to either `undefined` (no CDK CORS config) or just the bare `["*"]` retained as a belt-and-braces fallback.
- `infra/lib/constructs/annotate-stream-lambda.test.ts` asserts the in-handler origin echo via the SSE writer's response shape.
- End-to-end: a Vercel preview origin (`https://my-feature-abc123.vercel.app`) receives `Access-Control-Allow-Origin: https://my-feature-abc123.vercel.app` on the SSE response. An unauthorized origin receives no allow-origin header → browser blocks.

**Why we can't ignore it:**
- The streaming endpoint POSTs from authenticated browser sessions, so JWT theft via XSS on any page that holds the token is the actual threat — and browser CORS doesn't defend against that anyway. So the security delta is small.
- But: the design doc explicitly said "CORS allow-list is identical to the main Lambda's ... and is implemented in the new handler" (more-responsive-reading/design.md §Integration Points). The current state diverges from the design.
- Consistency with the main Lambda's pattern is worth ~50 lines of handler/sse-writer plumbing.

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing
**References:**
- PR #97 — workaround.
- `infra/lambda/src/index.ts:25` — `matchOrigin` to extract.
- `packages/shared/src/cors.ts` — where to put it.
- AWS docs on Function URL CORS (vs API Gateway): https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html#urls-cors

---

## `@language-drill/shared` emits ESM with extensionless relative imports

- **Status:** open (worked around in PR #94)
- **Discovered:** 2026-05-12 (production deploy failed after PR #91 merged the streaming-annotate feature)
- **Scope:** `packages/shared/` — its tsconfig + every relative `export * from "./x"` / `import { y } from "./z"` inside `src/`
- **Severity:** medium (currently survives via bundler lenience + a CDK-side workaround; will resurface whenever a Node-strict consumer is added)
- **See also:** [`aws-lambda-gotchas.md`](./aws-lambda-gotchas.md) §3 — the permanent reference for ts-node + CDK module resolution.

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
