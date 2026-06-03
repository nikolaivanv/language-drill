# Implementation Plan

## Task Overview

Phase 1 ships read-only Langfuse tracing as a strictly additive layer.
Implementation order: (1) add the `langfuse` dependency and prompt-version
exports so the wrapper has data to read, (2) build `observability.ts`
incrementally (no-op skeleton → create-path Proxy → stream-path Proxy),
(3) swap the three Lambda call sites one at a time, (4) wire CDK secrets,
(5) update `.env.example` and CLAUDE.md. Each task adds or updates tests
co-located with its code (CLAUDE.md "Testing" rule). The `LANGFUSE_PUBLIC
_KEY`-unset code path is exercised by every existing test, so a green
suite during early tasks proves the no-op contract (Req 1 AC 2 / Req 7
AC 4).

## Steering Document Compliance

- **Monorepo layout** (CLAUDE.md): all new code lives in `packages/ai/src/`
  and `infra/lambda/src/`. CDK changes live in `infra/lib/constructs/`.
  `packages/db` is not touched.
- **Forward-only Drizzle migrations**: no schema change — `submissionId`
  reuses `userExerciseHistory.id`'s existing `uuid().defaultRandom()`.
- **Tests gate task completion** (CLAUDE.md): every implementation task
  ends with a vitest run that must pass before marking complete.
- **Latest stable deps**: `langfuse` Node SDK v3+ (must verify not
  deprecated before installing).
- **Hono on Lambda**: flush hook is a Hono middleware in `index.ts`.
- **Secrets in AWS Secrets Manager**: two new secrets per env, follow
  the `${secretsPrefix}/…` pattern already used in `lambda.ts`.

## Atomic Task Requirements

Each task touches 1–3 related files, completes in 15–30 min, and has one
testable outcome. Files are listed by absolute path within the worktree
root. Requirements are referenced with `_Requirements: X.Y_` and existing
code to leverage with `_Leverage: path/to/file.ts_`.

## Tasks

- [x] 1. Add `langfuse` npm dependency to `packages/ai`
  - File: `packages/ai/package.json`
  - Add `"langfuse": "^3.x"` (verify the v3 line is the latest non-deprecated, per CLAUDE.md "Package Management"). Run `pnpm install` to update the lockfile.
  - Run `pnpm --filter @language-drill/ai typecheck` to confirm the package's existing build still passes with the new dep in place.
  - Purpose: make the SDK importable in subsequent tasks; no code change yet.
  - _Leverage: `packages/ai/package.json` (existing `@anthropic-ai/sdk` entry as the formatting model)_
  - _Requirements: 1.3, 7 (the SDK must be present but unused when keys absent)_

- [x] 2. Add six `*_VERSION` constants to the prompt source files
  - Files: `packages/ai/src/prompts.ts`, `packages/ai/src/annotate.ts`, `packages/ai/src/generation-prompts.ts`, `packages/ai/src/validation-prompts.ts`, `packages/ai/src/theory-prompts.ts`, `packages/ai/src/theory-validation-prompts.ts`
  - Export from each, one constant per file, placed next to the matching `*_SYSTEM_PROMPT`: `EVALUATION_SYSTEM_PROMPT_VERSION`, `ANNOTATE_SYSTEM_PROMPT_VERSION`, `GENERATION_PROMPT_VERSION`, `VALIDATION_PROMPT_VERSION`, `THEORY_GENERATION_PROMPT_VERSION`, `THEORY_VALIDATION_PROMPT_VERSION`. Format: `'<surface>@<YYYY-MM-DD>'` where `<YYYY-MM-DD>` is **today's date at implementation time** (not the spec-draft date) — e.g. `'evaluate@2026-05-12'`.
  - Purpose: enable per-prompt-version dashboard cohorting (Req 9 AC 3).
  - _Leverage: existing prompt export pattern in `packages/ai/src/prompts.ts:42`, `packages/ai/src/annotate.ts:94`_
  - _Requirements: 10.1, 10.2_

- [x] 3. Re-export the six `*_VERSION` constants from the `packages/ai` barrel
  - File: `packages/ai/src/index.ts`
  - Append exports alongside the matching existing exports (e.g. add `EVALUATION_SYSTEM_PROMPT_VERSION` to the `prompts.js` re-export block).
  - Run `pnpm --filter @language-drill/ai typecheck` to confirm the barrel is consistent.
  - Purpose: callers can import a single symbol per prompt for the trace metadata.
  - _Leverage: `packages/ai/src/index.ts:10-14` (existing `prompts.js` re-export block)_
  - _Requirements: 10.1_

- [x] 4. Create observability skeleton with ALS + `withLlmTrace` (no Langfuse calls)
  - File: `packages/ai/src/observability.ts` (NEW)
  - Add `LlmFeature`, `LlmEnv`, `LlmTraceContext` types; module-level `AsyncLocalStorage<LlmTraceContext>`; `withLlmTrace(ctx, fn)`; `createObservedClaudeClient(apiKey)` that for now ALWAYS returns `new Anthropic({ apiKey })` (Langfuse wiring comes in task 6).
  - Also export `LANGFUSE_FLUSH_TIMEOUT_MS = 200` and a stub `flushObservability` that resolves immediately. Export `__resetForTests()` that does nothing yet.
  - Re-export everything from `packages/ai/src/index.ts`.
  - Purpose: lock in the public API so call-site tasks (8–11) can compile against it before the Proxy lands.
  - _Leverage: `packages/ai/src/index.ts:141` (`createClaudeClient` is the unwrapped form)_
  - _Requirements: 1.1, 1.2, 1.5_

- [x] 5. Add tests for the observability skeleton
  - File: `packages/ai/src/observability.test.ts` (NEW)
  - Assert: `createObservedClaudeClient('x')` returns an `Anthropic` instance with a `messages.create` function (no Proxy yet); `withLlmTrace` propagates context — inside the callback, `AsyncLocalStorage.getStore()` returns the passed `LlmTraceContext` (test by exporting a private `__getCurrentContext()` helper from `observability.ts` for tests only, or by reading via a closure).
  - Run `pnpm --filter @language-drill/ai test` — must pass.
  - Purpose: pin the skeleton contract before the Proxy is added.
  - _Leverage: existing test pattern in `packages/ai/src/evaluate.test.ts`_
  - _Requirements: 1.1, 1.5_

- [x] 6. Add the `TOOL_NAME_TO_FEATURE` exported map
  - Files: `packages/ai/src/observability.ts`, `packages/ai/src/index.ts`
  - Add `export const TOOL_NAME_TO_FEATURE = new Map<string, LlmFeature>([...])` with the six entries listed in design §Component 1 (`submit_evaluation`→`evaluate`, `submit_annotated_words`→`annotate`, `submit_cloze_draft`/`submit_translation_draft`/`submit_vocab_recall_draft`→`generate`, `submit_validation_result`→`validate`, `submit_theory_topic`→`generate-theory`, `submit_theory_validation_result`→`validate-theory`). Cross-check exact tool-name strings against the existing exports (e.g. `EVALUATION_TOOL_NAME` in `evaluate.ts`, `ANNOTATE_TOOL_NAME` in `annotate.ts`, `TOOL_NAME_BY_TYPE` in `generate.ts`, `VALIDATION_TOOL_NAME`, `THEORY_TOOL_NAME`, `THEORY_VALIDATION_TOOL_NAME`).
  - Re-export from `index.ts`. Add a unit test asserting the map's keys exactly match `[...EVALUATION_TOOL_NAME, ...ANNOTATE_TOOL_NAME, ...]` so a future renamed tool fails the test loudly.
  - Purpose: feature-tag disambiguation source-of-truth.
  - _Leverage: `packages/ai/src/evaluate.ts:20`, `packages/ai/src/annotate.ts:23`, `packages/ai/src/generate.ts` (TOOL_NAME_BY_TYPE), `packages/ai/src/validate.ts`, `packages/ai/src/theory-generate.ts`, `packages/ai/src/theory-validate.ts`_
  - _Requirements: 3.1 (feature tag vocabulary), 2.1–2.6 (Proxy must pick the right feature)_

- [x] 7. Build the Langfuse singleton getter + `flushObservability` real implementation
  - File: `packages/ai/src/observability.ts`
  - Replace the stub from task 4. Add `getLangfuse()` that lazily constructs a `Langfuse` instance when both `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are present, using SDK defaults (no `flushAt`/`flushInterval` overrides). Wrap construction in try/catch (Req 7 AC 1). Implement `flushObservability` with `Promise.race(flushAsync, setTimeout)` at `LANGFUSE_FLUSH_TIMEOUT_MS`. Implement `__resetForTests()` so it null-resets the singleton and the once-warned flag.
  - Add tests: when keys are unset → `getLangfuse()` returns `null` and `flushObservability` resolves immediately; when keys are set (via a mocked `Langfuse` constructor) → singleton is returned; when the constructor throws → `getLangfuse` returns `null` with a single warn and `createObservedClaudeClient` still returns a vanilla Anthropic.
  - Purpose: prove the no-op contract end-to-end before any tracing logic lands.
  - _Leverage: `packages/ai/src/observability.ts` (from task 4)_
  - _Requirements: 1.2, 1.3, 6.5, 7.1, 7.3_

- [x] 8. Add the Anthropic Proxy — `messages.create` path
  - File: `packages/ai/src/observability.ts`
  - Replace `createObservedClaudeClient` to return `new Proxy(new Anthropic({apiKey}), …)` when `getLangfuse()` returns non-null. The Proxy's `messages.create` handler: (a) read ALS context, (b) read `request.tools[0]?.name`, look up `feature` in `TOOL_NAME_TO_FEATURE` (fallback to ALS `feature` + one-shot warn), (c) `langfuse.generation({…})` with `input = request.messages + system`, `model`, `metadata = {feature, env, requestId, submissionId, jobId, cellKey, exerciseId, candidateCount, promptVersion}`, `tags = [feature, env, model, language, cefrLevel, exerciseType].filter(Boolean)`, `userId = ctx.userId`, (d) `await inner.messages.create(...)`, (e) on success: `gen.end({ output: tool_use.input ?? content, usageDetails: mapUsageDetails(usage), costDetails: buildCostDetails(usage) })`, (f) on error: `gen.end({ level: 'ERROR', statusMessage: err.message })` and re-throw. Wrap every Langfuse SDK call in try/catch with a single-warn-per-cold-start gate.
  - Helper functions `mapUsageDetails` and `buildCostDetails` live in the same file; both pure and unit-testable. `buildCostDetails` reuses `SONNET_4_5_PRICING` from `cost-model.ts`.
  - Add three tests: success path emits a generation with the expected metadata + tags + output (assert via a mocked Langfuse client); error path finalizes with `level: 'ERROR'` and re-throws; Langfuse-throws path lets the underlying Claude call resolve normally.
  - Purpose: trace every non-streaming Claude call.
  - _Leverage: `packages/ai/src/cost-model.ts` (`SONNET_4_5_PRICING`)_
  - _Requirements: 1.3, 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.1, 3.2, 3.3, 4.1, 4.3, 5.1, 5.3, 7.1, 7.2_

- [x] 8b. Add cost-reconciliation round-trip test
  - File: `packages/ai/src/cost-model.test.ts`
  - Add one new case: for several realistic `Anthropic.Usage` fixtures (mixed input / cache-write / cache-read / output), assert that `sum(buildCostDetails(usage))` agrees with `estimateCostUsd(mapUsage(usage))` to within $0.0001. The two helpers live in `observability.ts` (added in task 8); import them in the test.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: lock the dashboard-vs-DB cost-parity contract (Req 4 AC 3).
  - _Leverage: `packages/ai/src/cost-model.ts` (existing `estimateCostUsd`, `SONNET_4_5_PRICING`), test cases in `packages/ai/src/cost-model.test.ts`_
  - _Requirements: 4.3_

- [x] 9. Add the Anthropic Proxy — `messages.stream` path
  - File: `packages/ai/src/observability.ts`
  - Extend the Proxy's `messages` sub-proxy with a `stream` handler. Wrap the returned async iterable in a generator that yields every event unchanged. Tee `content_block_delta` events with `delta.type === 'input_json_delta'` into a buffer that runs `extractNewItems` (already exported from `annotate.ts`) to collect `WordFlag` items in order. On `stream.finalMessage()`: finalize the Langfuse generation with `output = collectedFlags`, `usageDetails`, `costDetails`, and `stop_reason` (Req 5 AC 2). If `finalMessage.stop_reason === 'max_tokens'`, finalize with `level: 'WARNING'`. On thrown abort (`DOMException: aborted` or the SDK equivalent): finalize with `level: 'WARNING'`, `statusMessage: 'client_disconnect'`, and the partial collected list.
  - Add three tests: stream of 3 deltas yields 3 flags upstream and one generation finalized with 3 items; `max_tokens` stop_reason finalizes with `level: 'WARNING'`; aborted stream finalizes with `client_disconnect`.
  - Purpose: trace `streamAnnotation` calls without blocking TTFF.
  - _Leverage: `packages/ai/src/annotate.ts:289` (`extractNewItems`)_
  - _Requirements: 1.3, 2.2, 5.2, 5.3, 7.2_

- [x] 10. Add the Hono flush middleware
  - File: `infra/lambda/src/index.ts`
  - Import `flushObservability` from `@language-drill/ai`. Add `app.use('*', async (_c, next) => { try { await next(); } finally { await flushObservability(); } })` immediately before the existing `app.route(...)` calls.
  - Add a test in `infra/lambda/src/index.test.ts` (already exists per `grep` of `createClaudeClient`): asserts the middleware calls `flushObservability` exactly once per request via a mocked module.
  - Purpose: drain buffered traces before the Lambda freezes.
  - _Leverage: `infra/lambda/src/index.ts:39` (existing `app.use('*', cors(...))` placement model)_
  - _Requirements: 6.1, 6.5_

- [x] 11. Wire `evaluateAnswer` call site with UUID-as-submissionId
  - File: `infra/lambda/src/routes/exercises.ts`
  - Import `randomUUID` from `node:crypto` and replace `createClaudeClient` with `createObservedClaudeClient` (also import `withLlmTrace` and `EVALUATION_SYSTEM_PROMPT_VERSION`). After all rate-limit/usage checks pass, mint `const submissionId = randomUUID()`. Wrap the existing `evaluateAnswer(client, …)` call in `withLlmTrace({ feature: 'evaluate', userId, submissionId, requestId, language, cefrLevel, exerciseType, promptVersion: EVALUATION_SYSTEM_PROMPT_VERSION, env })`. Pass `id: submissionId` to the `db.insert(userExerciseHistory).values(...)` so the row id and the trace id are 1:1.
  - Purpose: link DB submission ↔ Langfuse trace (Req 9 AC 2).
  - _Leverage: `infra/lambda/src/routes/exercises.ts:191-217` (existing try/catch shape)_
  - _Requirements: 1.4, 2.1, 2.7, 2.8, 2.9_

- [x] 12. Update `exercises.test.ts` for the observability swap and submissionId contract
  - File: `infra/lambda/src/routes/exercises.test.ts`
  - Add cases: (a) when `LANGFUSE_PUBLIC_KEY` is unset (default), `POST /exercises/:id/submit` still inserts a row and returns the evaluation byte-identical to the pre-spec response; (b) `userExerciseHistory.id` equals the value the route sets (verify by stubbing `randomUUID` and asserting the inserted row's id); (c) when Langfuse env is set (with a mocked SDK), one generation is emitted with `metadata.submissionId === id` and `tags` includes `'evaluate'`.
  - Run `pnpm --filter @language-drill/lambda test` — must pass.
  - Purpose: lock in 1:1 mapping + no-op when keys absent.
  - _Leverage: `infra/lambda/src/routes/exercises.test.ts` (existing test setup + mock patterns)_
  - _Requirements: 2.7, 7.4_

- [x] 13. Wire `streamAnnotation` call site with `withLlmTrace` + flush
  - File: `infra/lambda/src/annotate-stream/handler.ts`
  - Replace `createClaudeClient` with `createObservedClaudeClient`. Wrap the `for await (const ev of streamAnnotation(...))` block in `withLlmTrace({ feature: 'annotate', userId, requestId, language, cefrLevel, promptVersion: ANNOTATE_SYSTEM_PROMPT_VERSION, candidateCount, env })`. Add a single `await flushObservability()` in a `finally` that wraps the entire handler body (so it runs on success, error, and abort paths).
  - Add `ANNOTATE_SYSTEM_PROMPT_VERSION` import from `@language-drill/ai`.
  - Purpose: trace annotation streams + drain buffer before Lambda freeze.
  - _Leverage: `infra/lambda/src/annotate-stream/handler.ts:172-238` (Steps 9–12 layout)_
  - _Requirements: 1.4, 2.2, 5.2, 6.2_

- [x] 14. Update `annotate-stream/handler.test.ts` for flush + trace context
  - File: `infra/lambda/src/annotate-stream/handler.test.ts`
  - Add: (a) `flushObservability` is called exactly once on `done` and once on `error` paths (mock the symbol from `@language-drill/ai`); (b) with mocked Langfuse, the trace carries `candidateCount` and `flaggedCount` (collected at stream end).
  - Run `pnpm --filter @language-drill/lambda test`.
  - Purpose: enforce flush contract for the streaming Lambda.
  - _Leverage: existing handler test scaffolding in `infra/lambda/src/annotate-stream/handler.test.ts`_
  - _Requirements: 6.2, 7.2_

- [x] 15. Wire the generation Lambda — module-scope client + per-record `withLlmTrace` + flush
  - File: `infra/lambda/src/generation/handler.ts`
  - Replace the cold-start `createClaudeClient` call at line 45 with `createObservedClaudeClient(requireEnv('ANTHROPIC_API_KEY'))`. Inside the per-record `try{}`, before the existing `runOneCell(...)` call, push a `withLlmTrace({ feature: 'generate', requestId: record.messageId, jobId: parsed.jobId, cellKey: buildCellKey(parsed.spec), language, cefrLevel, exerciseType, promptVersion: GENERATION_PROMPT_VERSION, env })` scope and execute `runOneCell` inside it. Add `await flushObservability()` in the per-record `finally`.
  - Import `GENERATION_PROMPT_VERSION` and `buildCellKey` (already imported from `@language-drill/db`).
  - Purpose: trace every generate + validate call from the background pipeline.
  - _Leverage: `infra/lambda/src/generation/handler.ts:45` (cold-start client), `infra/lambda/src/generation/handler.ts:30` (`buildCellKey` import)_
  - _Requirements: 1.4, 2.3, 2.4, 6.3_

- [x] 16. Update `generation/handler.test.ts` for flush + per-record trace scope
  - File: `infra/lambda/src/generation/handler.test.ts`
  - Add: (a) per-record `flushObservability` is called on success AND on failure branches; (b) the `withLlmTrace` ALS scope is entered before `runOneCell` and exited after; (c) `LANGFUSE_PUBLIC_KEY` unset → handler still returns `{ batchItemFailures: [...] }` identical to pre-spec.
  - Run `pnpm --filter @language-drill/lambda test`.
  - Purpose: prove the SQS handler honors the flush contract per record.
  - _Leverage: existing test patterns in `infra/lambda/src/generation/handler.test.ts`_
  - _Requirements: 6.3, 7.4_

- [x] 17. Add Langfuse secrets to the API Lambda CDK construct
  - File: `infra/lib/constructs/lambda.ts`
  - Add two `secretsmanager.Secret.fromSecretNameV2` lookups (`LangfusePublicKey`, `LangfuseSecretKey`) using the `${props.secretsPrefix}/LANGFUSE_*_KEY` pattern. Inject into `environment` as `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`. Also inject a non-secret `LANGFUSE_ENV: props.secretsPrefix === 'language-drill' ? 'prod' : 'dev'`. Call `grantRead(this.handler)` on both secrets.
  - Purpose: prod + dev Langfuse keys available at runtime (Req 8).
  - _Leverage: `infra/lib/constructs/lambda.ts:19-47` (existing secret lookup block), `infra/lib/constructs/lambda.ts:81-94` (existing environment block), `infra/lib/constructs/lambda.ts:97-102` (existing `grantRead` block)_
  - _Requirements: 8.1, 8.2_

- [x] 18. Add Langfuse secrets to the generation Lambda CDK construct
  - File: `infra/lib/constructs/generation-lambda.ts`
  - Same three-line addition as task 17, scoped to the SQS-driven Lambda.
  - Purpose: same secrets available in the generation handler.
  - _Leverage: `infra/lib/constructs/generation-lambda.ts:47` (existing secret lookup pattern), `infra/lib/constructs/lambda.ts` (as template)_
  - _Requirements: 8.1, 8.2_

- [x] 19. Add Langfuse secrets to the annotate-stream Lambda CDK construct
  - File: `infra/lib/constructs/annotate-stream-lambda.ts`
  - Same three-line addition as task 17, scoped to the streaming Function URL.
  - Purpose: same secrets available in the streaming handler.
  - _Leverage: `infra/lib/constructs/annotate-stream-lambda.ts:44-57` (existing secret lookups), `infra/lib/constructs/annotate-stream-lambda.ts:94` (existing environment block)_
  - _Requirements: 8.1, 8.2_

- [x] 20. Update construct tests for the new secrets
  - Files: `infra/lib/constructs/generation-lambda.test.ts`, `infra/lib/constructs/annotate-stream-lambda.test.ts`, **NEW** `infra/lib/constructs/lambda.test.ts`
  - For each of the three constructs, assert the synthesized Lambda environment includes `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_ENV`. Assert the two secrets receive a `grantRead` on the handler's role. Because `lambda.test.ts` does not exist today (the API-Lambda construct has no test file), create it following the shape of `generation-lambda.test.ts` — minimum: instantiate `ApiLambda` with `secretsPrefix: 'language-drill-dev'`, synth the stack, assert the env keys and the IAM grant.
  - Run `pnpm --filter @language-drill/infra test`.
  - Purpose: lock CDK wiring with a snapshot test across all three constructs.
  - _Leverage: `infra/lib/constructs/generation-lambda.test.ts:23` (`secretsPrefix` test fixture), `infra/lib/constructs/annotate-stream-lambda.test.ts` (shape for new `lambda.test.ts`)_
  - _Requirements: 8.1, 8.2_

- [x] 21. Add Langfuse env vars to `.env.example`
  - File: `.env.example`
  - Add a new section after the Anthropic block: `LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxxxxxx`, `LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxxxxxx`, commented optionals `LANGFUSE_BASE_URL` (default `https://cloud.langfuse.com`) and `LANGFUSE_SAMPLE_RATE` (default `1.0`), plus a comment pointing to the `language-drill-dev` Langfuse project for local dev (Req 8.3).
  - Purpose: onboard future contributors to local Langfuse config.
  - _Leverage: `.env.example:40-47` (Anthropic block as the formatting model)_
  - _Requirements: 8.3, 8.4_

- [x] 22. Update CLAUDE.md secrets table + add prompt-version reminder
  - File: `CLAUDE.md`
  - Add two rows to the "AWS Secrets Manager" table: `language-drill/LANGFUSE_PUBLIC_KEY` (source: Langfuse console → Project Settings → API Keys), `language-drill/LANGFUSE_SECRET_KEY` (same source). Add a new sentence to the "Package Management" section (or a new "Prompt Editing" subsection): _"When editing any `*_SYSTEM_PROMPT` constant in `packages/ai/src/`, bump the matching `*_PROMPT_VERSION` constant to today's date in the same commit. Dashboards cannot tell old and new traces apart otherwise."_
  - Purpose: keep the project guide authoritative; satisfy Req 10 AC 4.
  - _Leverage: `CLAUDE.md` existing "AWS Secrets Manager" 6-row table and "Package Management" section_
  - _Requirements: 8.1, 10.4_

- [x] 23. Full-suite gate — lint, typecheck, test from repo root
  - Run from the worktree root: `pnpm lint && pnpm typecheck && pnpm test`. All three must report zero failures. Fix any regressions before considering the implementation done.
  - Purpose: pre-push gate (CLAUDE.md "Pre-Push Checks").
  - _Leverage: existing scripts in root `package.json` (`lint`, `typecheck`, `test`)_
  - _Requirements: 7.4_

- [x] 24. Manual post-deploy verification — five day-one use cases
  - Files: none (operator runbook step)
  - After merging and the CDK deploy completes for the dev stack: (a) submit one answer from `apps/web` against dev API and verify a Langfuse trace appears in `language-drill-dev` with `submissionId` matching the new `userExerciseHistory.id`; (b) trigger one generation cell and verify N generate + 1..M validate traces share `jobId` and `cellKey`; (c) trigger one annotation and verify a single trace with `flaggedCount` and the WordFlag array; (d) pin five dashboards in the dev project covering Req 9 AC 1–5; (e) promote the dashboard definitions to the prod project.
  - Purpose: dashboard acceptance gate.
  - _Leverage: `docs/llm-observability.md §6` (the five use cases)_
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
