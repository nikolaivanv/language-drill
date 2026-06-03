# Requirements Document

## Introduction

The exercise generation pipeline's per-cell wall-clock is dominated by the **sequential** per-draft validation loop in `runOneCell` (`packages/db/src/generation/run-one-cell.ts:397-444`). For a typical 50-draft cell, that loop makes 50 sequential `validateDraft` Claude calls at ~3–8 s each — 150 to 400 s of pure-serial latency. Measurement on 2026-05-12: 9 successful cells took 325–402 s wall-clock; the 2 cells that exceeded the 900 s Lambda timeout were both `vocab_recall` umbrellas where this serial validation slope blew the budget.

This spec **parallelizes the validator fan-out** with a small concurrency cap (5–8 in-flight `validateDraft` calls per cell), tuned to stay under the Anthropic Sonnet 4.6 org-tier rate limit. The sequential dedup-retry semantics, audit-row accounting, abort signal, and existing fail-closed behaviour are all preserved — this is a "make the slow part faster" change, not a redesign.

Out of scope (separate work): parallelizing `generateBatch`'s per-ordinal generation loop (also serial — see `docs/tech-debt.md` for the broader fix), and the soft-deadline / audit-row finalization patch tracked in `.claude/bugs/zombie-running-audit-rows-on-lambda-timeout/`. Both become less load-bearing once this lands but neither is closed by it.

## Alignment with Product Vision

The product depends on a pre-generated content pool that the scheduler refills under target (`MIN_PER_CELL = 25`). When per-cell wall-clock approaches the Lambda timeout, cells silently die mid-run, leaving the pool under-target and producing operational toil (today: 2 zombie audit rows requiring direct DB writes to recover). Parallelizing validation removes the headline reason cells exceed 900 s, restoring the "scheduler quietly refills the pool overnight" property that's load-bearing for the always-fresh-exercises promise to learners.

## Requirements

### Requirement 1 — Bounded-concurrency validator fan-out

**User Story:** As the generation pipeline operator, I want the per-draft validation loop in `runOneCell` to run with bounded parallelism, so that 50-draft cells complete in ~60–90 s instead of 325–400 s.

#### Acceptance Criteria

1. WHEN `runOneCell` reaches the per-draft loop (`run-one-cell.ts:397`) THEN the first `validateDraft` call for each draft SHALL be dispatched concurrently, capped at `MAX_VALIDATOR_CONCURRENCY` in-flight calls.
2. WHEN `MAX_VALIDATOR_CONCURRENCY` validations are already in flight AND a new draft is ready THEN the dispatcher SHALL queue the new validation behind one of the in-flight ones (no unbounded fan-out).
3. WHEN every draft's first validation has either resolved or rejected THEN `runOneCell` SHALL proceed with the existing routing (`routeValidationResult`) and INSERT / dedup-retry path for each draft in turn.
4. WHEN `MAX_VALIDATOR_CONCURRENCY` is 1 THEN behaviour SHALL be byte-identical to the current serial loop (no regression path; the parameter is the only knob).

### Requirement 2 — Preserve dedup-retry semantics

**User Story:** As the generation pipeline operator, I want the existing dedup-retry behaviour to keep working unchanged under parallel validation, so that cells with high in-cell duplicate rates still converge on inserts via `runRetryGeneration` without producing extra inserts or losing the per-draft retry budget.

#### Acceptance Criteria

1. WHEN a draft's first INSERT collides on the `_dedupKey` index (`run-one-cell.ts:264-265`) THEN that draft's subsequent retry-generate + revalidate iterations SHALL run **sequentially** inside `validateAndInsertWithRetry` (no parallelism applied to retries — only to the first-attempt validation).
2. WHEN two parallel drafts produce the same canonical surface AND both pass validation THEN exactly one INSERT SHALL succeed; the other SHALL observe an empty `RETURNING` from `onConflictDoNothing` and enter the existing retry-generate path (no change vs. serial behaviour at the row level).
3. WHEN the retry budget (`MAX_DEDUP_RETRIES = 3`) is exhausted for any draft THEN the existing `dedup-given-up` terminal status SHALL still be reported.

### Requirement 3 — Token usage, counters, and audit row stay correct

**User Story:** As the operator who reads `generation_jobs` rows and CloudWatch logs, I want the `tokenUsage`, `validatedCount`, `approvedCount`, `flaggedCount`, `rejectedCount`, `insertedCount`, `dedupGivenUpCount`, `malformedDraftCount`, and `inBatchDuplicateCount` aggregations on `CellResult` to match the values a serial run on the same drafts would have produced, so that audit and cost reporting stay accurate.

#### Acceptance Criteria

1. WHEN parallel validations resolve out of order THEN the final `combinedUsage` SHALL equal the sum of each validation's `tokenUsage` regardless of resolution order (commutative + associative aggregation).
2. WHEN drafts terminate with mixed outcomes (insert / flagged / rejected / dedup-given-up) under parallelism THEN each `CellResult` counter SHALL equal the count under the equivalent serial run.
3. WHEN the cell completes successfully THEN the audit row's `producedCount`, `approvedCount`, `flaggedCount`, `rejectedCount` fields SHALL reflect the parallel outcome's totals.

### Requirement 4 — AbortSignal cancellation propagates

**User Story:** As a CLI user driving generation manually, I want `Ctrl+C` to interrupt an in-flight cell within seconds of pressing it, so that I don't have to wait for 50 outstanding validations to drain after I cancel.

#### Acceptance Criteria

1. WHEN `signal.aborted` becomes true while validations are in flight THEN the dispatcher SHALL stop enqueueing new validations.
2. WHEN any in-flight validation observes `signal.aborted` (via the existing `if (signal?.aborted) throw …` checks at `run-one-cell.ts:189`, `194`, `383`, `388`, `399`) THEN it SHALL reject with the existing `'Aborted by user (SIGINT)'` error.
3. WHEN any single validation rejects with the SIGINT error THEN `runOneCell` SHALL enter the outer `try/catch` → `failClosed` path with the existing message (no behavioural drift on cancellation).

### Requirement 5 — Concurrency cap is configurable and documented

**User Story:** As the operator tuning against Anthropic rate limits, I want `MAX_VALIDATOR_CONCURRENCY` to be a single named constant with a documented default, so that the limit can be raised or lowered without code archaeology.

#### Acceptance Criteria

1. WHEN the code defines `MAX_VALIDATOR_CONCURRENCY` THEN it SHALL be a single named constant in `packages/db/src/generation/run-one-cell.ts` with a documenting comment that names the Anthropic Sonnet 4.6 org-tier rate limit and the Lambda's `reservedConcurrency: 3` as the relevant constraints.
2. WHEN the default value is chosen THEN it SHALL be 5 unless deliberate measurement justifies a different number (the cost of a wrong default is bounded: too low = serial-like slope; too high = 429 errors which the existing retry semantics already tolerate).
3. WHEN a future maintainer needs to change the default THEN the comment SHALL link to `docs/tech-debt.md` "Per-draft validation loop" entry for the broader context.

## Non-Functional Requirements

### Performance

- Per-cell wall-clock for a 50-draft cell SHALL drop from 325–400 s (today) to ≤ 120 s (target) with `MAX_VALIDATOR_CONCURRENCY = 5`, assuming no infrastructure failure and a typical mix of insert / flagged / rejected outcomes. Measured against the equivalent `runOneCell` invocation on the same `GenerationSpec` against a mocked Anthropic client.
- The 900 s Lambda timeout SHALL stop being the practical ceiling for any cell type in the curriculum (including `vocab_recall` umbrellas) under normal Claude latencies.

### Security

- No new attack surface. The parallelization is internal to `runOneCell`; no new network surface, no new user input, no new secrets.

### Reliability

- Token-usage and counter aggregation SHALL remain **commutative and associative** so that out-of-order resolution from `Promise.allSettled` (or equivalent) produces deterministic `CellResult` values.
- Anthropic 429 rate-limit errors SHALL flow through the existing per-draft error path (validator throw → cell terminal-failed via outer catch, or — with PR #87's loss-tolerance — captured as malformed). No silent swallowing.
- The existing `cell terminal-failed` and `cell succeeded` log lines in the Lambda handler SHALL keep firing with the same shape; the only observable wire-shape change is a faster `durationMs` value.

### Usability

- The CLI's per-cell output line (`generate-exercises.ts:147-168`) SHALL continue to render correctly. The only intentional change is a shorter wall-clock figure.
