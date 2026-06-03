# Requirements Document

## Introduction

The weekly production theory-generation sweep on **2026-06-01** processed 36 Turkish cells (the Yedi İklim TR A1/A2 expansion's first production pass) and produced a **36% hard-failure rate**: 21 auto-approved, 2 validator-rejected, and **13 cells failed with `Theory draft malformed: Invalid sections: must be a non-empty array`**. All 13 failures share one cause — the `submit_theory_topic` tool call returned the `sections` field as a **JSON-serialized string** instead of a native array, and that string is **itself malformed** (inner double-quotes left unescaped, e.g. `"text": " ("there is / exists") and "`).

This is the failure mode the prior spec (`theory-gen-observability-resilience`) explicitly deferred under "Explicitly Out of Scope" with the trigger: _"revisit if the failure rate exceeds 25% per cell."_ At 36%, that trigger has fired. This spec is that follow-up.

Critically, a naive fix already exists and is insufficient. `parseTheoryTopicJson` (`packages/shared/src/theory.ts:326-334`) already detects a string-typed `sections` and attempts `JSON.parse` on it. That defense recovers the case where the model stringifies **valid** JSON, but today's failures stringify **invalid** JSON (unescaped inner quotes), so `JSON.parse` throws, the code falls through, and `requireNonEmptyArray` rejects the raw string. The real fix must recover or avoid the malformed-stringification case, not merely parse a clean string.

The same run also exposed four observability and resilience gaps that let a third of the run fail silently:

1. **Lost token accounting** — failed cells recorded `NULL` tokens and `$0` cost even though the generation Claude call burned tokens; the run's true cost is ~30% higher than the recorded `$2.79`.
2. **A blind alarm** — `TheoryGenerationErrorsAlarm` watches the Lambda `Errors` metric, but the handler catches malformed cells and returns normally, so a 36% failure rate produced **zero** alarm signal (alarm stayed `OK`).
3. **Backoff blind to hard failures** — the rejection-backoff from the prior spec only counts `rejected = true`; `status = 'failed'` cells re-enqueue weekly forever if the failure is deterministic.
4. **Validator chain-of-thought leak** — the two rejection reasons persisted to `error_message` contain the validator thinking out loud mid-field (`"...wait, let me reconsider"`), which is noise for any operator or reviewer UI.

This spec fixes the malformed-`sections` failure and closes all four gaps.

## Alignment with Product Vision

The product-vision steering (`.claude/steering/product.md`) frames the app as portfolio-quality and AI-cost-conscious; the tech steering (`.claude/steering/tech.md`) makes the pre-generated content pool the cost-control bet and Langfuse/CloudWatch the observability posture.

- A 36% generation-failure rate on a new language directly undermines the pre-generated pool: Turkish learners get an incomplete theory library, and the failures cost real (unrecorded) tokens. **Requirement 1** restores the pool's completeness; **Requirement 2** restores cost visibility.
- The CLAUDE.md "Observability boundaries" contract says Lambda errors live in CloudWatch and LLM traces in Langfuse. An alarm that cannot see application-level failures (**Requirement 3**) and a backoff that cannot see hard failures (**Requirement 4**) are regressions against that contract.
- **Requirement 5** keeps the audit trail (`error_message`) operator-readable, which is the whole point of the prior spec's Req 1.

## Requirements

### Requirement 1 — Recover or prevent malformed `sections` stringification

**User Story:** As a learner studying Turkish theory, I want generation to succeed on cells where the model stringifies the `sections` array, so that the theory pool is complete rather than missing a third of its pages.

#### Acceptance Criteria

The recovery pipeline for a single returned draft is an explicit ordered sequence: **(i)** decode a valid stringified `sections` → **(ii)** if that fails, attempt a tolerant JSON-repair pass → **(iii)** if that fails, regenerate the cell → **(iv)** if retries are exhausted, record `status = 'failed'`.

1. WHEN `generateTheoryTopic` receives a tool-use block whose `sections` is a string containing **valid** JSON THEN the system SHALL decode it to a native array and proceed (this is the existing `theory.ts:326` behavior and SHALL be preserved).
2. WHEN `generateTheoryTopic` receives a tool-use block whose `sections` is a string containing **malformed** JSON THEN the system SHALL attempt a tolerant JSON-repair pass before treating the draft as malformed, and that repair SHALL be **deterministic** (same input → same output). The repair is **best-effort**: it recovers the recoverable subset of unescaped-quote stringifications (e.g. a single unescaped inner quote), but is NOT required to recover every shape. The captured 2026-06-01 payload shape — a stringified `sections` array with **multiple** unescaped inner double-quotes inside `text` values, which defeats general JSON-repair heuristics — is recovered by the **pipeline as a whole**: when repair fails, the regenerate retry (R1.3) is the guaranteed recovery, since the failure is intermittent at temperature 0.4 and a re-roll usually parses cleanly.
3. WHEN both decode (R1.1) and repair (R1.2) fail for the returned draft THEN `generateTheoryTopic` (or its caller `runOneTheoryCell`) SHALL **regenerate** the cell up to a configurable maximum number of additional attempts (`THEORY_GENERATION_MAX_RETRIES`, default 2 → up to 3 total Claude calls) before recording the cell as failed, because the failure is intermittent (temperature 0.4) and a retry usually parses.
4. WHEN a regeneration retry occurs THEN the system SHALL emit a structured `warn` log line `{level:'warn', cellKey, attempt, message:'theory draft malformed — regenerating'}` per retry, so retry frequency is visible in CloudWatch.
5. WHEN the theory generation system prompt is rendered THEN it SHALL instruct the model to return `sections` as a **native JSON array** (never a string) and to **escape or avoid raw double-quotes** inside `text` values (e.g. prefer guillemets «…» / typographic quotes), reducing the probability of the malformed stringification at the source.
6. WHEN the generation system prompt changes per R1.5 THEN `THEORY_GENERATION_PROMPT_VERSION` (`packages/ai/src/theory-prompts.ts`) SHALL be bumped to today's date per the CLAUDE.md prompt-editing rule.
7. WHEN unit tests run THEN `theory.ts` parser tests SHALL cover: (a) a native `sections` array passes unchanged, (b) a valid stringified `sections` is decoded, (c) a malformed stringified `sections` from the **repairable subset** (a single unescaped inner quote) is recovered by the best-effort repair, (c2) the captured 2026-06-01 multi-quote shape — which the repair cannot fix — falls through to a clear throw (so the pipeline retries it), and (d) an unrecoverable garbage string still throws a clear error. `theory-generate.test.ts` SHALL cover the regenerate-on-malformed retry loop, including **recovery of the captured multi-quote shape via retry** (success on a later attempt; exhaustion after max retries).
8. WHEN unit tests run THEN there SHALL be a test asserting the rendered generation system prompt contains the native-array / quote-escaping instruction from R1.5 (string-presence check, since model behavior is not deterministically unit-testable).
9. WHEN the retry budget is exhausted THEN the cell SHALL be recorded as `status = 'failed'` exactly as today (no infinite retry), and Requirement 2's token accounting SHALL still apply to every attempt.

### Requirement 2 — Record token usage on malformed/failed drafts

**User Story:** As an operator tracking AI cost, I want a failed cell's generation tokens and cost recorded in `theory_generation_jobs`, so that the run's true cost is visible instead of being silently under-counted by ~30%.

#### Acceptance Criteria

1. WHEN `generateTheoryTopic` throws because the draft is malformed THEN the token usage from the underlying Claude `response.usage` SHALL be captured **before** the parse step and propagated to the caller (e.g. attached to a typed error or returned via a discriminated result), rather than discarded.
2. WHEN `runOneTheoryCell` closes an audit row as `status = 'failed'` due to a generator throw THEN it SHALL write the captured `input_tokens_used`, `output_tokens_used`, and `cost_usd_estimate` for the attempt(s) that ran, instead of `ZERO_USAGE`.
3. WHEN multiple regeneration attempts (Requirement 1.3) run for one cell THEN the recorded usage SHALL be the **sum** across all attempts for that cell, so cost is not under-counted on retried cells.
4. WHEN a cell succeeds THEN this requirement SHALL NOT change the recorded usage (success-path accounting is unchanged).
5. WHEN unit tests run THEN there SHALL be a test asserting a malformed-draft failure records non-zero `input_tokens_used`/`cost_usd_estimate` (not `ZERO_USAGE`).

### Requirement 3 — Alarm on application-level theory failures

**User Story:** As an operator, I want a CloudWatch alarm that fires when theory cells fail at the application level, so that a high failure rate surfaces the same day instead of staying invisible behind a green Lambda-`Errors` alarm.

#### Acceptance Criteria

The metric namespace `LanguageDrill/TheoryGeneration` and metric name `CellFailed` are fixed by these criteria (not illustrative), so that R3.6's tests and R3.4's alarm have a concrete, stable target. A `skipped-cost-cap` outcome is a deliberate budget stop, **not** a failure, and SHALL NOT emit `CellFailed`.

1. WHEN the theory handler records a cell as `status = 'failed'` THEN it SHALL emit a custom CloudWatch metric `CellFailed` (value 1) in namespace `LanguageDrill/TheoryGeneration`, carrying the environment (`LANGFUSE_ENV`/stage) as a dimension, in addition to the existing structured log line. A `status = 'skipped-cost-cap'` outcome SHALL NOT increment `CellFailed`.
2. WHEN a cell succeeds THEN the handler SHALL emit `CellFailed` value 0 (same metric, same dimensions) so the alarm can distinguish "no runs" from "all-passing" without false-negatives on a fully-healthy sweep.
3. WHEN the metric is emitted THEN it SHALL use a mechanism that does not add a blocking network round-trip on the hot path where avoidable — CloudWatch Embedded Metric Format (EMF) via the existing `console.log` JSON channel is the chosen mechanism, preferred over a synchronous `PutMetricData` call.
4. WHEN the CDK stack synthesizes THEN `infra/lib/constructs/theory-generation-lambda.ts` SHALL define a new alarm `TheoryGenerationCellFailuresAlarm` on the `CellFailed` metric (SUM over 1 day, threshold ≥ 5 failed cells in one day, `treatMissingData: NOT_BREACHING`), separate from the existing Lambda-`Errors` alarm, with an `alarmDescription` stating it tracks application-level cell failures distinct from Lambda runtime errors.
5. WHEN the existing `TheoryGenerationErrorsAlarm` is reviewed THEN it SHALL be retained (it still catches genuine Lambda crashes/timeouts) — this requirement ADDS an alarm, it does not replace one.
6. WHEN unit/snapshot tests run THEN there SHALL be a CDK assertion (via `aws-cdk-lib/assertions` Template) that `TheoryGenerationCellFailuresAlarm` exists on the `CellFailed` metric, and a handler test asserting the `CellFailed=1` EMF line is emitted on a `'failed'` result and `CellFailed=0` on success.

### Requirement 4 — Count hard failures toward rejection backoff

**User Story:** As an operator who doesn't want deterministically-failing cells burning tokens weekly, I want `status = 'failed'` cells to count toward the scheduler's backoff suppression, so that a permanently-broken cell becomes a bounded cost like a permanently-rejected one.

#### Acceptance Criteria

1. WHEN `enqueueMissingTheoryCells` (`infra/lambda/src/theory-generation/scheduler.ts`) builds its suppression set THEN the per-`cell_key` count SHALL include rows where `rejected = true` **OR** `status = 'failed'` within the existing `THEORY_REJECTION_BACKOFF_WINDOW_DAYS` window (a single combined "unproductive attempt" counter).
2. WHEN a cell accumulates ≥ `THEORY_REJECTION_BACKOFF_THRESHOLD` combined unproductive attempts in the window THEN it SHALL be suppressed from enqueue, exactly as rejections are today.
3. WHEN the count query runs THEN it SHALL remain a **single aggregate SELECT** per sweep over the existing `theory_generation_jobs_cell_idx` index (no per-cell queries, no added round-trips).
4. WHEN a cell is suppressed THEN the existing structured `warn` log line SHALL be emitted and SHALL add an explicit `recentUnproductiveAttempts` field carrying the combined count. The existing `recentRejections` field SHALL be **retained** alongside it (carrying the rejection-only sub-count) so any operator alerting already keyed on `recentRejections` does not break; the `message` string SHALL be updated to reflect suppression by combined unproductive attempts.
5. WHEN the backoff constant names no longer match their meaning (they reference "rejection") THEN the design MAY rename them to reflect "unproductive attempts," but renaming is OPTIONAL and SHALL NOT change the default values (`THRESHOLD = 3`, `WINDOW_DAYS = 14`).
6. WHEN unit tests run THEN scheduler tests SHALL cover: (a) 2 failures + 0 rejections passes, (b) 3 failures + 0 rejections is suppressed, (c) 2 failures + 1 rejection is suppressed (combined counting), (d) failures older than the window do not count.

### Requirement 5 — Validator emits only the final, concise reason

**User Story:** As an operator reading `error_message` or a future reviewer UI, I want each `flaggedReasons` entry to be a single concise final reason, so that I'm not parsing the validator's chain-of-thought ("...wait, let me reconsider").

#### Acceptance Criteria

1. WHEN the theory validation system prompt (`packages/ai/src/theory-validation-prompts.ts`) describes the `flaggedReasons` field THEN it SHALL instruct the model to emit **one concise final reason per issue**, with no step-by-step reasoning, self-correction, or hedging in the field value.
2. WHEN the validation system prompt changes THEN `THEORY_VALIDATION_PROMPT_VERSION` SHALL be bumped to today's date per the CLAUDE.md prompt-editing rule.
3. WHEN the prompt change merges THEN the Langfuse `production` prompt for theory-validate SHALL be synced per the CLAUDE.md "Prompt Editing" runbook (operational step, noted in tasks, not unit-testable).
4. WHEN unit tests run THEN there SHALL be an assertion that the rendered validation prompt contains the concise-reason instruction (string presence), since the model output itself is not deterministically unit-testable.

## Non-Functional Requirements

### Performance

- Regeneration retries (Req 1.3) are bounded by `THEORY_GENERATION_MAX_RETRIES` and only fire on the malformed-draft path, so the happy path adds zero Claude calls. Worst-case cost per stuck cell is bounded (≤ 3 generations) and, with Req 4's backoff, capped over time.
- The JSON-repair pass (Req 1.2) MUST be a pure in-process transform with no network I/O.
- The scheduler's combined backoff query (Req 4) MUST remain a single aggregate read over the existing index — same complexity as today.
- The custom CloudWatch metric (Req 3) MUST NOT add a blocking round-trip on the hot path (EMF via stdout is preferred).

### Security

- No new secrets. All changes use credentials already in scope (`DATABASE_URL`, `ANTHROPIC_API_KEY`, Langfuse keys).
- `error_message` and `flaggedReasons` remain model-authored English about global content; no PII pathway is opened.
- If a JSON-repair library is added (Req 1.2), it MUST be actively maintained, dependency-light, and free of known vulnerabilities per the CLAUDE.md package policy.

### Reliability

- The retry loop MUST be bounded — under no circumstances may a single cell regenerate indefinitely.
- Token accounting (Req 2) MUST never cause a generation to fail: if usage extraction itself throws, the cell still records as failed (best-effort accounting, fail-open).
- Backoff exclusions remain reversible: aging unproductive attempts out of the 14-day window re-admits a cell automatically, so a fixed prompt re-attempts without manual re-enqueue.

### Usability

- All new log lines MUST be structured JSON via the existing `log(...)` helper so operators can grep/alert on them.
- The new alarm's `alarmDescription` MUST state plainly that it tracks application-level cell failures (distinct from Lambda runtime errors).

## Explicitly Out of Scope

- **Retroactive backfill** of token usage / `error_message` for the 13 historical 2026-06-01 failed rows. The re-enqueue (below) regenerates them with the fix; the old rows stay as-is.
- **Re-enqueueing the 13 failed cells** is an **operational step performed after this spec is implemented and deployed**, not spec code. It is tracked as the final task but executed via the existing CLI / SQS path, not by new application code.
- **Redesigning the theory tool schema** to be less deeply-nested (a larger change that might reduce stringification probability further). If retries + prompt hardening don't drop the failure rate below ~5%, revisit as a follow-up.
- **Replacing the generation model** or changing temperature.
