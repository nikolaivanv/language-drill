# Implementation Plan

## Task Overview

Nine atomic tasks across four files (plus their test files) and one CDK construct (plus its test). Each task is a literal mirror of an analogous pattern already shipping on the exercise-generation surface. No new abstractions, no new modules. Tasks are ordered by complexity (smallest first) and grouped so that tests immediately follow the implementation they cover.

The four design components are independently mergeable — each impl + tests pair (1+2, 3+4, 5+6, 7+8) can ship as a standalone PR if useful, though one bundled PR is the expected default. Notable independence: **Tasks 5 (handler wiring) and 7 (CDK env vars) do not have to ship in the same PR.** Without Task 7, Task 5 still merges safely — the Proxy passes through silently because `getLangfuse()` returns null. Task 7 is what makes the Req 2 rollout-verification smoke check pass; before that, traces just don't get emitted.

**Note on line numbers:** every line-anchor cited below was accurate at spec-time, but will drift as tasks land. Executing agents must verify line numbers from the current file state rather than relying on cited values; the surrounding context (function name, branch label, constant name) is the durable anchor.

## Steering Document Compliance

- **tech.md** — every task touches the same files and patterns already documented as the canonical implementation for the exercise surface (`packages/db/src/generation/`, `infra/lambda/src/generation/`, `infra/lib/constructs/generation-lambda.ts`).
- **No structure.md exists** — implicit conventions (handler at `infra/lambda/src/{surface}/handler.ts`, orchestration at `packages/db/src/{surface}/run-one-cell.ts`, scheduler at `infra/lambda/src/{surface}/scheduler.ts`, tests co-located) are respected.

## Atomic Task Requirements

Each task touches 1–2 files and is completable in 15–30 minutes. Test tasks are listed separately from implementation tasks so they can be done sequentially without context-switching.

## Tasks

- [x] 1. Persist `errorMessage` on the rejected branch in `run-one-cell.ts`
  - File: `packages/db/src/theory-generation/run-one-cell.ts` (modify existing — lines 295–325, the `'rejected'` case)
  - Compute `rawMessage` from `decision.flaggedReasons.join('; ')` with empty-array fallback to `'rejected (no reasons reported)'`
  - Apply `.slice(0, ERROR_MESSAGE_MAX_LENGTH)` using the existing module constant at line 65
  - Add `errorMessage` to the `.set({...})` payload of the existing UPDATE statement — do not change any other field
  - Do not modify the `'flagged'`, `'auto-approved'` INSERT, or `'auto-approved'` dedup-skip branches
  - Purpose: Make rejection rationale readable from `theory_generation_jobs.error_message` without re-running a probe
  - _Leverage: existing `ERROR_MESSAGE_MAX_LENGTH` at line 65, existing UPDATE-statement pattern in the same file (lines 301-313 today)_
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Add rejected-branch `errorMessage` test cases in `run-one-cell.test.ts`
  - File: `packages/db/src/theory-generation/run-one-cell.test.ts` (modify existing)
  - Add case: "persists `error_message` joined from `decision.flaggedReasons`" — assert UPDATE call payload contains `errorMessage: 'reason1; reason2'`
  - Add case: "writes the empty-reasons sentinel when `flaggedReasons` is `[]`" — assert payload contains `errorMessage: 'rejected (no reasons reported)'`
  - Add case: "truncates `error_message` to `ERROR_MESSAGE_MAX_LENGTH` when joined reasons exceed 1000 chars" — feed an array whose join is > 1000 chars, assert the persisted string is exactly 1000 chars
  - Add case: "does NOT introduce new `errorMessage` writes on the `'flagged'` or `'auto-approved'`-INSERT branches" — assert those branches' UPDATE/INSERT payloads have `errorMessage: undefined`. Note: the pre-existing dedup-skip test at the line-400 path stays green and is unrelated.
  - Purpose: Pin the rejected-branch behavior + prevent regression on the other branches
  - _Leverage: existing test fixtures and mocks in the same file_
  - _Requirements: 1.5_

- [x] 3. Add rejection-count constants, query, and exclusion filter in `scheduler.ts`
  - File: `infra/lambda/src/theory-generation/scheduler.ts` (modify existing)
  - Add module-level constants near `SLOW_QUERY_WARNING_MS` (line 52): `THEORY_REJECTION_BACKOFF_THRESHOLD = 3`, `THEORY_REJECTION_BACKOFF_WINDOW_DAYS = 14`
  - Import `theoryGenerationJobs` alongside the existing `theoryTopics` import; import `and`, `gte`, `sql` from `drizzle-orm` if not already present
  - After the existing approval-set query (lines 96-105), add a second aggregate query: `SELECT cell_key, COUNT(*)::int FROM theory_generation_jobs WHERE rejected = true AND started_at >= now() - interval '14 days' GROUP BY cell_key`
  - Wrap the new query in a `Date.now()` start/end pattern and emit a `warn` log via the existing `log({...})` helper when the duration exceeds `SLOW_QUERY_WARNING_MS` — verify by reading `scheduler.ts:96-114` that the approval-set query already uses this exact wrapper shape before mirroring it; if the existing code drifts from what design Component 4's sketch shows, follow the live file
  - Build a `suppressedCells: Set<string>` from rows where `count >= THEORY_REJECTION_BACKOFF_THRESHOLD`, keyed by `cell.cellKey` (NOT by `${language}|${grammarPointKey}` — see design Component 4 "Two key-spaces" note)
  - In the existing diff loop (lines 124-138), after the `approvedSet.has(lookup)` check, add `if (suppressedCells.has(cell.cellKey)) { log({...}); continue; }` with the warn-log shape from design Component 4
  - Purpose: Cap the per-cell weekly token annuity for deterministically-failing cells; surface them in CloudWatch
  - _Leverage: existing approval-set query pattern (lines 96-105), `SLOW_QUERY_WARNING_MS` constant, module-local `log` helper, existing diff loop, `theory_generation_jobs_cell_idx` index_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 4. Add backoff-filter test cases in `scheduler.test.ts`
  - File: `infra/lambda/src/theory-generation/scheduler.test.ts` (modify existing)
  - Add case: "cell with 0 rejections passes the filter"
  - Add case: "cell with 2 rejections in the last 14 days passes the filter"
  - Add case: "cell with 3 rejections in the last 14 days is excluded AND emits the structured warn log exactly once"
  - Add case: "cell with 3 rejections but the oldest is 15 days old (2 in window) passes the filter"
  - Add case: "two excluded cells emit the structured warn log exactly twice — not once, not three times"
  - Add case: "the rejection-count query is invoked exactly once per sweep" — spy on the Drizzle client's `select` method count
  - Purpose: Pin the boundary-condition behavior (off-by-one at threshold, window aging) and lock the single-query invariant
  - _Leverage: existing scheduler test fixtures and Neon test branch harness_
  - _Requirements: 3.8 (and verifies 3.5 spy-invariant)_

- [x] 5. Wrap `runOneTheoryCell` dispatch in `withLlmTrace` + add `flushObservability` in theory handler
  - File: `infra/lambda/src/theory-generation/handler.ts` (modify existing)
  - Import `withLlmTrace`, `flushObservability`, `THEORY_GENERATION_PROMPT_VERSION` from `@language-drill/ai`
  - Wrap the existing `runOneTheoryCell(...)` call in `await withLlmTrace({...}, () => runOneTheoryCell(...))`. **Use the multi-line shape from design Component 2's implementation sketch verbatim** — do not collapse onto one line, and reuse the existing `parsed`, `cell`, `record` bindings from the surrounding scope rather than introducing new locals. Fields on the context object: `feature: 'generate-theory'`, `env: (process.env.LANGFUSE_ENV ?? 'dev') as 'prod' | 'dev'`, `promptVersion: THEORY_GENERATION_PROMPT_VERSION`, `requestId: record.messageId`, `jobId: parsed.jobId`, `cellKey: cell.cellKey`, `language: parsed.spec.language`, `cefrLevel: parsed.spec.cefrLevel`, `exerciseType: 'theory'`.
  - In the per-record `finally` block (alongside the existing `clearTimeout(timer)`), add `await flushObservability();`
  - Do not change the AbortController logic, the audit-row idempotency guard, or any other per-record flow
  - Purpose: Open the ALS frame the Anthropic Proxy reads, so generate + validate Claude calls emit Langfuse traces
  - _Leverage: exact context shape from `infra/lambda/src/generation/handler.ts:222-249`, existing `flushObservability` usage at `generation/handler.ts:301`, `TOOL_NAME_TO_FEATURE` map in `observability.ts:130-139` (no change needed)_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 6. Add `withLlmTrace`-wiring test cases in theory `handler.test.ts`
  - File: `infra/lambda/src/theory-generation/handler.test.ts` (modify existing)
  - Add case: "wraps `runOneTheoryCell` in `withLlmTrace` with the expected context shape" — mock `withLlmTrace` OR call `getCurrentLlmTraceContext()` inside a stub `runOneTheoryCell`; assert the frame carries `feature: 'generate-theory'`, `promptVersion: THEORY_GENERATION_PROMPT_VERSION`, `cellKey`, `language`, `cefrLevel`, `jobId`, `requestId`, `env`, `exerciseType: 'theory'`
  - Add case: "calls `flushObservability` once per SQS record's `finally` block" — spy on the export
  - Purpose: Lock the ALS-context contract so a future refactor can't silently break trace tagging
  - _Leverage: parallel test pattern in `infra/lambda/src/generation/handler.test.ts` (look for `withLlmTrace` / `getCurrentLlmTraceContext` usage)_
  - _Requirements: 2.7_

- [x] 7. Wire Langfuse secrets + env vars into the theory generation Lambda CDK construct
  - File: `infra/lib/constructs/theory-generation-lambda.ts` (modify existing)
  - Add two `secretsmanager.Secret.fromSecretNameV2(this, '<id>', `${props.secretsPrefix}/LANGFUSE_PUBLIC_KEY`)` and `.../LANGFUSE_SECRET_KEY` imports (mirror the existing `databaseUrl` / `anthropicApiKey` pattern at the top of the constructor)
  - In the `environment` block (line ~99), add three keys: `LANGFUSE_PUBLIC_KEY: langfusePublicKey.secretValue.unsafeUnwrap()`, `LANGFUSE_SECRET_KEY: langfuseSecretKey.secretValue.unsafeUnwrap()`, `LANGFUSE_ENV: props.envName === 'production' ? 'prod' : 'dev'`
  - After the existing `databaseUrl.grantRead(this.handler); anthropicApiKey.grantRead(this.handler);` (lines 107-108), add `langfusePublicKey.grantRead(this.handler); langfuseSecretKey.grantRead(this.handler);`
  - Purpose: Make Component 2's `withLlmTrace` wiring actually emit traces in prod — without these env vars, `getLangfuse()` returns null and the Proxy passes through
  - _Leverage: literal copy of `infra/lib/constructs/generation-lambda.ts` lines 60-65 (secret import) and 105-115 (env block + grantRead). The `language-drill/LANGFUSE_PUBLIC_KEY` and `language-drill/LANGFUSE_SECRET_KEY` Secrets Manager entries already exist in both dev and prod (used by the exercise Lambda)._
  - _Requirements: 2.1, 2.3 (preconditions for Component 2 to function at runtime)_

- [x] 8. Add Langfuse-env CDK test case in `theory-generation-lambda.test.ts`
  - File: `infra/lib/constructs/theory-generation-lambda.test.ts` (modify existing)
  - Add case: "Lambda environment includes `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_ENV`" — assert via the CDK `Template` snapshot the same way `generation-lambda.test.ts:68-69` does
  - Purpose: Pin the env-var contract so a future CDK refactor can't drop these
  - _Leverage: assertion shape from `infra/lib/constructs/generation-lambda.test.ts` (lines around 68-69)_
  - _Requirements: 2.1, 2.3_

- [x] 9. Run pre-push checks and fix any failures
  - Files: any (per-package)
  - Run `pnpm lint && pnpm typecheck && pnpm test` from repo root per CLAUDE.md
  - All three must report zero failures in the touched packages (`packages/db`, `packages/ai`, `infra/lambda`, `infra/`)
  - Two pre-existing unrelated failures are acceptable and should be left alone: `infra/test/stack.dev.test.ts` (CDK synth hook timeout) and `packages/ai/scripts/eval-export.test.ts` (missing drizzle-orm transitive). These were documented as out-of-scope in PR #176's verification.
  - Purpose: Confirm the bundle is ready to push and meets the project's pre-push contract
  - _Leverage: CLAUDE.md "Pre-Push Checks" section_
  - _Requirements: All_
