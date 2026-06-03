# Requirements Document

## Introduction

The theory-generation pipeline shipped in Phase 3 (commits `c63f7d3`, `ebe0ccb`) without three orchestrator-level guards that the exercise-generation pipeline takes for granted: rejection reasons aren't written to the audit row, Claude calls aren't traced in Langfuse, and the scheduler doesn't back off from cells that fail repeatedly. The `tr-a1-locative` bug (PR #176) surfaced the cost: a single deterministically-failing cell burned ~$0.085/day indefinitely, and diagnosing it required running a probe directly against the live prompts because neither the DB nor Langfuse held a usable verdict.

This spec closes those three gaps so the next stuck cell is visible the same day, costs are bounded, and diagnosis follows the existing exercise-side observability path instead of needing one-off probe scripts.

## Alignment with Product Vision

The product-vision steering (`.claude/steering/product.md`) frames this app as portfolio-quality and AI-cost-conscious. The tech-stack steering (`.claude/steering/tech.md`) calls out two principles this spec depends on:

- **Pre-generated content pool** is the cost-control bet — the per-cell daily annuity of a stuck cell is exactly the failure mode that bet doesn't tolerate (Req 3 bounds the loss).
- **AI-heavy: content generation, answer evaluation, explanations** — Langfuse traces are how that cost is observed and tuned. Theory not being traced today is a regression against the platform's observability posture (Req 2 fixes it).

The CLAUDE.md "Observability boundaries" section already documents that LLM traces belong in Langfuse; theory generation silently violates that contract. The remediation is mechanical: theory mirrors the exercise-side wiring that already lives in `infra/lambda/src/generation/handler.ts`.

## Requirements

### Requirement 1 — Persist rejection reasons to the theory audit row

**User Story:** As a developer debugging a stuck theory cell, I want `theory_generation_jobs.error_message` to carry the validator's flaggedReasons whenever a cell was rejected, so that I can read the reason directly from the DB without rerunning a probe.

#### Acceptance Criteria

1. WHEN `runOneTheoryCell` reaches the `'rejected'` branch in `packages/db/src/theory-generation/run-one-cell.ts` THEN the `UPDATE theory_generation_jobs` statement SHALL set `errorMessage = decision.flaggedReasons.join('; ')`.
2. WHEN `decision.flaggedReasons` is empty (i.e. validator returned `rejected = true` with `flaggedReasons.length === 0`, which the router should already prevent) THEN the system SHALL still write a non-null `errorMessage` of the form `"rejected (no reasons reported)"` so a NULL value never indicates "unknown rejection."
3. WHEN the audit row is later read by an operator or follow-up tooling THEN the `error_message` column SHALL contain the same string the flagged branch would write to `theory_topics.flagged_reasons[]` joined by `'; '`.
4. WHEN the `'flagged'` or `'auto-approved'` branches run THEN this requirement SHALL NOT introduce any new `errorMessage` writes. The pre-existing dedup-skip write on the auto-approved branch (`'cell already filled (partial index collision)'` at `run-one-cell.ts:400`) is preserved as-is — it predates this spec and is unrelated.
5. WHEN unit tests run THEN there SHALL be at least one test in `run-one-cell.test.ts` asserting `errorMessage` is persisted on a rejected verdict, and one asserting it is NOT set on a flagged or approved verdict.

### Requirement 2 — Trace theory generation in Langfuse

**User Story:** As a developer triaging a theory-generation regression, I want every `generateTheoryTopic` and `validateTheoryDraft` Claude call to appear in Langfuse with `feature=generate-theory` or `feature=validate-theory` tags, so that I can see per-cell verdicts, token spend, and prompt versions without writing probe scripts.

#### Acceptance Criteria

1. WHEN the theory handler at `infra/lambda/src/theory-generation/handler.ts` dispatches `runOneTheoryCell` THEN the dispatch SHALL be wrapped in `withLlmTrace` with `feature='generate-theory'`, mirroring the shape used by the exercise handler at `infra/lambda/src/generation/handler.ts:222-249`.
2. WHEN a theory cell-job completes (success or terminal failure) THEN the handler's per-record `finally` block SHALL call `flushObservability()` so traces land before the Lambda freezes.
3. WHEN `generateTheoryTopic` calls Claude THEN the resulting Langfuse trace SHALL carry `name='generate-theory'`, `metadata.cellKey`, `metadata.language`, `metadata.cefrLevel`, `metadata.promptVersion = THEORY_GENERATION_PROMPT_VERSION`, `metadata.jobId`, `metadata.requestId` (the SQS messageId), and `metadata.env` (from `LANGFUSE_ENV`).
4. WHEN `validateTheoryDraft` runs inside the same ALS scope THEN the Anthropic Proxy's `TOOL_NAME_TO_FEATURE` map SHALL disambiguate the trace to `name='validate-theory'` based on the outgoing tool name `submit_theory_validation_result` — no additional ALS scope or code change is required for the validate call.
5. WHEN Langfuse keys are unset OR `getLangfuse()` returns null THEN the theory handler SHALL behave identically to today (no-op trace), with zero added latency.
6. WHEN unit tests run THEN there SHALL be a handler-level test asserting `withLlmTrace` is called with the expected context shape, OR an integration-style test using `getCurrentLlmTraceContext()` inside a stub to verify the ALS frame.

#### Rollout Verification (post-deploy, not unit-testable)

- After one daily theory sweep on production, querying Langfuse for `name=generate-theory` AND `tags:env:prod` MUST return a non-zero trace count (today's count is zero). This is a manual smoke check at rollout, not a unit-testable acceptance criterion.

### Requirement 3 — Per-cell rejection backoff in the scheduler

**User Story:** As an operator who doesn't want token cost from deterministically-failing cells, I want the scheduler to stop enqueueing a cell once it accumulates a configurable number of rejections within a rolling window, so that a stuck cell becomes a bounded one-time cost (not a daily annuity) and surfaces for manual review.

#### Acceptance Criteria

1. WHEN `enqueueMissingTheoryCells` in `infra/lambda/src/theory-generation/scheduler.ts` builds its enqueue set THEN it SHALL exclude cells where `theory_generation_jobs` contains 3 or more rows with `rejected = true` AND `started_at >= now() - interval '14 days'` for the same `cell_key`.
2. WHEN a cell is excluded by the backoff filter THEN the scheduler SHALL emit a structured log line of level `warn` with shape `{level: 'warn', cellKey, recentRejections, backoffWindowDays, message: 'theory cell suppressed by rejection backoff'}` per excluded cell, so the count is visible in CloudWatch without DB queries.
3. WHEN no cells are excluded by backoff THEN the scheduler SHALL NOT log any backoff lines (avoid noise on the happy path).
4. WHEN a cell's rejection-count window passes (e.g. one of the 3 rejections ages past 14 days) THEN the cell SHALL automatically re-enter the enqueue set on the next sweep — no human action required.
5. WHEN the scheduler runs THEN it SHALL execute exactly one aggregate SELECT against `theory_generation_jobs` per sweep (verifiable via a spy on the Drizzle client in unit tests) using the existing `theory_generation_jobs_cell_idx` index (on `cell_key, started_at DESC`) — NOT one query per candidate cell.
6. WHEN the rejection-count query exceeds the existing `SLOW_QUERY_WARNING_MS` threshold in production THEN the scheduler SHALL log a `warn` line, mirroring the existing approval-query slow-path. _(This AC is production-observability, not unit-tested.)_
7. WHEN the backoff thresholds need to be re-tuned THEN they SHALL live in named constants (`THEORY_REJECTION_BACKOFF_THRESHOLD = 3`, `THEORY_REJECTION_BACKOFF_WINDOW_DAYS = 14`) in the scheduler file.
8. WHEN unit tests run THEN scheduler tests SHALL cover: (a) a cell with 0 rejections passes the filter, (b) a cell with 2 rejections in 14 days passes, (c) a cell with 3 rejections in 14 days is excluded, (d) a cell with 3 rejections but the oldest is 15 days old passes, (e) the structured log line is emitted exactly once per excluded cell.

#### Decisions (not requirements)

- **In-code constants over env vars.** Env-configurable backoff was rejected in the scope discussion as overkill — if thresholds need to vary across deploys, that decision can be revisited.

## Non-Functional Requirements

### Performance

- The added rejection-count query in the scheduler MUST be a single aggregate read (not per-cell). With the `theory_generation_jobs_cell_idx` index in place, scan cost is O(rejected rows in window), which is bounded by `total cells × backoff threshold` — currently ≤ ~150 rows even worst-case.
- `withLlmTrace` adds zero measurable latency when Langfuse is disabled (the existing observability layer already pins this in `observability.ts:269-302`).
- Persisting `errorMessage` adds zero extra round-trips (it's a column in the same UPDATE statement).

### Security

- No new secrets are introduced. All three changes use credentials already in scope (`DATABASE_URL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`).
- `error_message` is operator-facing; the validator's `flaggedReasons` strings are model-authored English. No PII pathway is opened — theory cells are global content, not user-scoped.

### Reliability

- Backoff exclusions are reversible: aging rejections out of the 14-day window automatically re-admits a cell. This is intentional (lets a fixed prompt re-attempt without human re-enqueue).
- `flushObservability()` failures are already swallowed by the existing observability layer (`observability.ts:902-920`); a Langfuse outage cannot fail a theory-generation request.
- The audit-row `errorMessage` write happens inside the existing UPDATE statement — same transactional guarantees as today.

### Usability

- The CloudWatch backoff log line MUST be machine-parseable (structured JSON via `log(...)`, not free-form text) so operators can grep / alert on it.
- The Langfuse trace metadata fields (`cellKey`, `language`, `cefrLevel`, `promptVersion`) MUST match the field names already used by the exercise surface so dashboards filter both surfaces uniformly.

## Explicitly Out of Scope

- **Anthropic-side `sections`-as-invalid-JSON-string crashes** (item #4 from the bug verification). With Req 3's backoff in place, intermittent transient parser crashes don't compound into a runaway cost — the daily scheduler keeps retrying cheaply until one parses. Captured as a deferred follow-up; revisit if the failure rate exceeds 25% per cell.
- **Surfacing backoff-suppressed cells in a UI**. The CloudWatch log line in Req 3 AC 2 is sufficient for the current operator (the author). A future admin dashboard could read `theory_generation_jobs` directly.
- **Retroactive rejection-reason backfill** for the existing 22 `theory_generation_jobs` rows on prod (where `error_message` is NULL for past rejected runs). The historical record is small; a one-off CLI is overkill.
- **Configurable backoff thresholds via env vars**. The user opted for in-code constants in the scope discussion. If thresholds need tuning across deploys, that decision can be revisited.
