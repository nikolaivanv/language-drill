# Implementation Plan

## Task Overview

Layered fix for the 36% theory-generation hard-failure rate plus four observability/resilience gaps. Work proceeds bottom-up: parser repair (shared) → generator retry + typed error (ai) → failure-path token accounting (db) → prompt hardening (ai) → CloudWatch metric + alarm (infra) → combined scheduler backoff (infra). Each code task is paired with a co-located test task per the "add tests to the existing test file for that module" rule, and no DB migration is needed (the failure path writes columns that already exist). Two operational tasks (Langfuse prompt sync, historical re-enqueue) are listed last and are explicitly non-code.

## Steering Document Compliance

- **Monorepo boundaries (tech.md §4 / CLAUDE.md):** parsing stays in `packages/shared`, generator/prompts in `packages/ai`, per-cell DB orchestration in `packages/db`, Lambda handler/scheduler in `infra/lambda`, CDK in `infra/lib`. No cross-boundary imports added (the generator derives `cellKey` locally rather than importing `@language-drill/db`).
- **Prompt-editing rule (CLAUDE.md):** prompt edits land in the `*_SYSTEM_PROMPT_TEMPLATE` constants (preserving byte-parity tests) and bump the matching `*_PROMPT_VERSION` to `@2026-06-02` in the same task.
- **Observability boundaries:** the new failure signal is a CloudWatch metric/alarm; no Langfuse or Sentry surface is touched.
- **Tests co-located** beside each module; **pre-push checks** (`pnpm lint`/`typecheck`/`test`) gate the work.

## Atomic Task Requirements
- **File Scope:** 1–3 related files per task
- **Time Boxing:** 15–30 minutes each
- **Single Purpose:** one testable outcome per task
- **Specific Files:** exact paths below
- **Agent-Friendly:** clear input/output, minimal context switching

## Tasks

### Requirement 1 — recover/prevent malformed `sections`

- [x] 1. Add `jsonrepair` dependency to the shared package
  - File: `packages/shared/package.json`
  - Add `jsonrepair` (latest stable) to `dependencies` (currently only `zod`); run `pnpm install` to update the lockfile
  - Purpose: provide the best-effort tolerant-repair primitive for Component 1
  - _Leverage: existing `dependencies` block in `packages/shared/package.json`_
  - _Requirements: 1.2_

- [x] 2. Add best-effort repair fallback to `parseTheoryTopicJson`
  - File: `packages/shared/src/theory.ts`
  - Inside the existing `if (typeof normalized.sections === "string")` branch (lines 327-334), extract a pure `decodeMaybeRepaired(raw: string): unknown` helper: `JSON.parse` first (preserves R1.1); on throw, `JSON.parse(jsonrepair(raw))`; on throw again, return `undefined` (clean fall-through to `requireNonEmptyArray`). Adopt the result only when `Array.isArray`
  - Keep the helper deterministic and side-effect-free; import `jsonrepair` from `jsonrepair`
  - Purpose: recover the repairable subset of stringified `sections` without a Claude re-roll
  - _Leverage: `packages/shared/src/theory.ts:314-334` (`parseTheoryTopicJson`, existing decode + `requireNonEmptyArray`)_
  - _Requirements: 1.1, 1.2_

- [x] 3. Add parser repair tests
  - File: `packages/shared/src/theory.test.ts`
  - Cover R1.7: (a) native `sections` array unchanged; (b) valid stringified `sections` decoded; (c) single-unescaped-inner-quote shape recovered by repair + repair output stable across two calls (deterministic); (c2) captured multi-quote shape (`"…"var" ("there is / exists") and "yok"…"` as a fixture string) throws a clear `Invalid sections` error; (d) garbage string throws
  - Purpose: pin the best-effort repair boundary and the fall-through-to-throw behavior the retry depends on
  - _Leverage: existing `parseTheoryTopicJson` test cases in `packages/shared/src/theory.test.ts`_
  - _Requirements: 1.7_

- [x] 4. Add `TheoryDraftMalformedError` and capture usage before parsing
  - Files: `packages/ai/src/theory-generate.ts`, `packages/ai/src/index.ts`
  - Define `export class TheoryDraftMalformedError extends Error { constructor(message: string, readonly tokenUsage: ClaudeUsageBreakdown) }`; re-export from `index.ts`
  - In `generateTheoryTopic`, move `const usage = readUsage(response)` to immediately after `client.messages.create(...)` (before the tool-use/parse checks); convert the three malformed throw sites (no tool_use block, wrong tool name, parse throw at lines 403-419) to `throw new TheoryDraftMalformedError(message, usage)`. Leave the two top guards (EN / non-grammar) as plain `Error` (no usage, pre-call)
  - Purpose: propagate per-attempt usage on the malformed path (R2.1) and make the malformed case distinguishable for retry
  - _Leverage: `packages/ai/src/theory-generate.ts:339` (`readUsage`), `:400-419` (throw sites); `packages/ai/src/cost-model.ts` (`ClaudeUsageBreakdown`)_
  - _Requirements: 2.1_

- [x] 5. Add bounded regenerate retry loop to `generateTheoryTopic`
  - File: `packages/ai/src/theory-generate.ts`
  - Add `export const THEORY_GENERATION_MAX_RETRIES = 2`; change signature to `generateTheoryTopic(client, spec, opts?: { maxRetries?: number })` (default the const). Wrap the create+parse body in a loop over attempts; accumulate usage with `addUsage` into a `cumulativeUsage`; on a `TheoryDraftMalformedError` with attempts remaining, emit `console.log(JSON.stringify({ level:'warn', cellKey, attempt, message:'theory draft malformed — regenerating' }))` and continue; on exhaustion rethrow `TheoryDraftMalformedError(msg, cumulativeUsage)`; on success return `{ draft, tokenUsage: cumulativeUsage }`
  - Derive `cellKey` locally as `` `${spec.language}:${spec.cefrLevel}:${spec.grammarPoint.key}`.toLowerCase() `` (byte-identical to `buildTheoryCellKey`, no `@language-drill/db` import — add a comment); keep `draft.metadata` reflecting the winning attempt
  - Purpose: guaranteed recovery of intermittent malformed drafts + summed usage (R1.3, 1.4, 2.3)
  - _Leverage: `packages/ai/src/cost-model.ts` (`addUsage`); `packages/db/src/lib/theory-cell-key.ts:42` (cellKey format to mirror)_
  - _Requirements: 1.3, 1.4, 2.3, 1.9_

- [x] 6. Add retry-loop tests
  - File: `packages/ai/src/theory-generate.test.ts`
  - Using the existing `makeStubClient` helper, add a multi-response stub: (i) captured multi-quote shape then valid draft → succeeds on attempt 2, returns summed usage; (ii) all-malformed → throws `TheoryDraftMalformedError` after `maxRetries` with non-zero `tokenUsage`; (iii) assert one `warn` line per retry (spy on `console.log`, check `{level,cellKey,attempt,message}`); (iv) EN/non-grammar guards still throw pre-call with no usage
  - Purpose: cover the guaranteed-recovery path and exhaustion (R1.7, R2.5)
  - _Leverage: `packages/ai/src/theory-generate.test.ts` (`makeStubClient`, `baseSpec` fixtures)_
  - _Requirements: 1.7, 2.5_

### Requirement 2 — token accounting on failure

- [x] 7. Write captured usage on the failure path in `runOneTheoryCell`
  - File: `packages/db/src/theory-generation/run-one-cell.ts`
  - In the generator-throw `catch` (lines 213-224), set `tokenUsage = err instanceof TheoryDraftMalformedError ? err.tokenUsage : ZERO_USAGE` and pass it to `failClosed`. In `failClosed` (lines 481-512), add `inputTokensUsed` (sum of the three input tiers), `outputTokensUsed`, and `costUsdEstimate` (`estimateCostUsd(...).toFixed(4)`) to the audit-row `.set({...})`; wrap the accounting computation so any throw still records `status='failed'` (fail-open)
  - Import `TheoryDraftMalformedError` from `@language-drill/ai`
  - Purpose: record real tokens/cost on failed cells instead of NULL/$0 (R2.2)
  - _Leverage: `packages/db/src/theory-generation/run-one-cell.ts:213-224, 481-512`; `packages/ai/src/cost-model.ts` (`estimateCostUsd`, `ZERO_USAGE`)_
  - _Requirements: 2.2, 2.4_

- [x] 8. Add failure-path token-accounting test
  - File: `packages/db/src/theory-generation/run-one-cell.test.ts`
  - With a stub generator that throws `TheoryDraftMalformedError(msg, nonZeroUsage)`, assert the mocked `db.update().set(...)` payload on the failed row carries non-zero `inputTokensUsed` and `costUsdEstimate` (not `ZERO_USAGE`), and `status='failed'`
  - Purpose: lock in R2.2 against regressions (R2.5)
  - _Leverage: existing failure-path tests + db mock in `packages/db/src/theory-generation/run-one-cell.test.ts`_
  - _Requirements: 2.5_

### Requirement 1.5 / 5 — prompt changes

- [x] 9. Harden the generation system prompt and bump its version
  - File: `packages/ai/src/theory-prompts.ts`
  - In `THEORY_SYSTEM_PROMPT_TEMPLATE`'s `## Output format` block (around line 94), add an instruction: return `sections` as a **native JSON array (never a JSON string)** and inside `text` values **avoid raw double-quotes — prefer guillemets «…» / typographic quotes, escaping any literal `"`**. Bump `THEORY_GENERATION_PROMPT_VERSION` to `theory-generate@2026-06-02`. Do not add new `{{vars}}` (keep `computeTheoryPromptVars` unchanged so byte-parity holds)
  - Purpose: reduce malformed stringification at the source (R1.5, 1.6)
  - _Leverage: `packages/ai/src/theory-prompts.ts:50, 94-96`_
  - _Requirements: 1.5, 1.6_

- [x] 10. Add generation-prompt instruction test
  - File: `packages/ai/src/theory-prompts.test.ts`
  - Assert the rendered system prompt contains the native-array / quote-escaping instruction (string-presence) and `THEORY_GENERATION_PROMPT_VERSION === 'theory-generate@2026-06-02'`; confirm the existing byte-parity test still passes
  - Purpose: pin R1.5/1.6 (R1.8)
  - _Leverage: existing render + byte-parity tests in `packages/ai/src/theory-prompts.test.ts`_
  - _Requirements: 1.8_

- [x] 11. Make `flaggedReasons` concise in the validation prompt and bump its version
  - File: `packages/ai/src/theory-validation-prompts.ts`
  - Amend the `flaggedReasons` dimension description in `THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE` (around line 125): "Emit one concise final reason per issue — state only the conclusion, no step-by-step reasoning, self-correction, or hedging (never 'wait, let me reconsider…')." Bump `THEORY_VALIDATION_PROMPT_VERSION` to `theory-validate@2026-06-02`
  - Purpose: keep `error_message`/reviewer UI free of validator chain-of-thought (R5.1, 5.2)
  - _Leverage: `packages/ai/src/theory-validation-prompts.ts:74, 125`_
  - _Requirements: 5.1, 5.2_

- [x] 12. Add validation-prompt instruction test
  - File: `packages/ai/src/theory-validation-prompts.test.ts`
  - Assert the rendered prompt contains the concise-reason instruction and `THEORY_VALIDATION_PROMPT_VERSION === 'theory-validate@2026-06-02'`; confirm byte-parity test still passes
  - Purpose: pin R5.1/5.2 (R5.4)
  - _Leverage: existing render + byte-parity tests in `packages/ai/src/theory-validation-prompts.test.ts`_
  - _Requirements: 5.4_

### Requirement 3 — application-level alarm

- [x] 13. Create the `CellFailed` EMF emitter with unit tests
  - Files: `infra/lambda/src/theory-generation/metrics.ts` (new), `infra/lambda/src/theory-generation/metrics.test.ts` (new)
  - Implement `emitCellOutcomeMetric(status: TheoryCellResult['status'], env: string): void`: `skipped-cost-cap` → no emit; else `console.log(JSON.stringify(...))` with the EMF envelope (`_aws.Timestamp`, `CloudWatchMetrics:[{Namespace:'LanguageDrill/TheoryGeneration', Dimensions:[['env']], Metrics:[{Name:'CellFailed'}]}]`, top-level `env`, `CellFailed: failed?1:0`)
  - Tests: failed→`CellFailed:1`, succeeded→`CellFailed:0`, skipped-cost-cap→no `console.log`; envelope/namespace/`env` dimension shape asserted
  - Purpose: zero-round-trip application-failure metric (R3.1, 3.2, 3.3)
  - _Leverage: `console.log(JSON.stringify(...))` pattern in `infra/lambda/src/theory-generation/handler.ts:71`; `TheoryCellResult` from `@language-drill/db`_
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 14. Wire `emitCellOutcomeMetric` into the handler
  - File: `infra/lambda/src/theory-generation/handler.ts`
  - Compute `const env = process.env.LANGFUSE_ENV ?? 'dev'`; call `emitCellOutcomeMetric('succeeded', env)` in the success branch (before its `continue`, line 275) and `emitCellOutcomeMetric(result.status, env)` in the terminal-failure branch (lines 281-287). Do NOT emit in the `runOneTheoryCell`-threw `catch` (lines 253-265) — that path defers to SQS redelivery + the Lambda-`Errors` alarm
  - Purpose: emit the metric on every terminal outcome (R3.1, 3.2)
  - _Leverage: `infra/lambda/src/theory-generation/handler.ts:268-296` (result branches), `:230` (existing `LANGFUSE_ENV` read)_
  - _Requirements: 3.1, 3.2_

- [x] 15. Add handler EMF-emission tests
  - File: `infra/lambda/src/theory-generation/handler.test.ts`
  - With `runOneTheoryCell` stubbed to return `succeeded` / `failed` / `skipped-cost-cap`, assert the handler emits `CellFailed=1` on failed, `CellFailed=0` on success, and no `CellFailed` line on skipped-cost-cap (spy on `console.log`)
  - Purpose: lock in handler emit sites (R3.6)
  - _Leverage: existing `runOneTheoryCell` stubbing + log capture in `infra/lambda/src/theory-generation/handler.test.ts`_
  - _Requirements: 3.6_

- [x] 16. Add `TheoryGenerationCellFailuresAlarm` to the CDK construct
  - File: `infra/lib/constructs/theory-generation-lambda.ts`
  - Add `public readonly cellFailuresAlarm: cloudwatch.Alarm`; construct it on `new cloudwatch.Metric({ namespace:'LanguageDrill/TheoryGeneration', metricName:'CellFailed', dimensionsMap:{ env: props.secretsPrefix === 'language-drill' ? 'prod' : 'dev' }, period: Duration.days(1), statistic: Stats.SUM })`, `threshold:5`, `evaluationPeriods:1`, `GREATER_THAN_OR_EQUAL_TO_THRESHOLD`, `treatMissingData: NOT_BREACHING`, with an `alarmDescription` stating it tracks application-level cell failures distinct from Lambda runtime errors. Leave `errorsAlarm` untouched
  - Purpose: alarm on application-level failures, retaining the runtime-errors alarm (R3.4, 3.5)
  - _Leverage: `infra/lib/constructs/theory-generation-lambda.ts:151-166` (existing alarm idiom), `:125-126` (env derivation)_
  - _Requirements: 3.4, 3.5_

- [x] 17. Add CDK alarm assertion test
  - File: `infra/lib/constructs/theory-generation-lambda.test.ts`
  - Via `Template.fromStack(...)`, assert an alarm with `MetricName:'CellFailed'`, `Namespace:'LanguageDrill/TheoryGeneration'`, `Threshold:5`, `ComparisonOperator:'GreaterThanOrEqualToThreshold'`, `TreatMissingData:'notBreaching'` exists, and that `TheoryGenerationErrorsAlarm` still exists
  - Purpose: pin alarm shape + non-removal of the existing alarm (R3.6, 3.5)
  - _Leverage: existing `aws-cdk-lib/assertions` Template tests in `infra/lib/constructs/theory-generation-lambda.test.ts`_
  - _Requirements: 3.6, 3.5_

### Requirement 4 — combined backoff

- [x] 18. Count `failed` cells toward the scheduler backoff
  - File: `infra/lambda/src/theory-generation/scheduler.ts`
  - Replace the rejection-count query (lines 148-160) with a single aggregate SELECT filtering `or(eq(rejected,true), eq(status,'failed'))` within the window, returning `unproductive: COUNT(*)` and `rejections: COUNT(*) FILTER (WHERE rejected = true)`; suppress when `unproductive >= THRESHOLD`. Update the suppression `warn` line to add `recentUnproductiveAttempts` and retain `recentRejections` (rejection-only sub-count), and reword `message` to `'theory cell suppressed by unproductive-attempt backoff'`. Rename the two constants to `THEORY_BACKOFF_THRESHOLD`/`THEORY_BACKOFF_WINDOW_DAYS` (values unchanged: 3, 14). Add `or` to the `drizzle-orm` import
  - Purpose: bound deterministically-failing cells like rejected ones (R4.1–4.5)
  - _Leverage: `infra/lambda/src/theory-generation/scheduler.ts:65-66, 143-204`_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 19. Add combined-backoff scheduler tests
  - File: `infra/lambda/src/theory-generation/scheduler.test.ts`
  - Cover R4.6: (a) 2 failures + 0 rejections passes; (b) 3 failures + 0 rejections suppressed; (c) 2 failures + 1 rejection suppressed (combined); (d) failures older than the window don't count. Assert the suppression log carries both `recentUnproductiveAttempts` and `recentRejections`, and the count query still runs exactly once per sweep
  - Purpose: lock in combined counting + single-query invariant (R4.6, 4.3)
  - _Leverage: existing backoff tests in `infra/lambda/src/theory-generation/scheduler.test.ts:436-585`_
  - _Requirements: 4.6_

### Verification + operational (post-merge)

- [x] 20. Run the full pre-push suite and fix any failures
  - Files: (repo root)
  - Run `pnpm lint`, `pnpm typecheck`, `pnpm test` from the repo root; resolve any failures introduced by tasks 1–19
  - Purpose: satisfy the CLAUDE.md pre-push gate before opening the PR
  - _Leverage: CLAUDE.md "Pre-Push Checks"_
  - _Requirements: all_

- [ ] 21. (Operational, non-code) Sync the theory-validate prompt to Langfuse
  - After merge, run `pnpm push-prompts` for `theory-validate-system-prompt` in dev then prod per the CLAUDE.md "Prompt Editing" runbook; confirm with `bootstrap-prompts --check`
  - Purpose: make the live prompt body match the in-repo edit from task 11 (R5.3)
  - _Leverage: CLAUDE.md "Prompt Editing" runbook, `pnpm push-prompts`_
  - _Requirements: 5.3_

- [ ] 22. (Operational, non-code) Re-enqueue the 13 historical 2026-06-01 failed cells
  - After deploy, re-enqueue the failed Turkish cells via the existing CLI/SQS path (no new code); verify they generate cleanly and the new `CellFailed` metric stays below the alarm threshold on the next sweep
  - Purpose: regenerate the lost pages with the fix in place (out-of-scope as code; tracked here)
  - _Leverage: existing theory-generation CLI / SQS enqueue path_
  - _Requirements: 1 (operational validation)_
