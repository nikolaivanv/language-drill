# Implementation Plan

## Task Overview

Six atomic tasks across two files (one new, one modified). The implementation is surgical: a new bounded worker pool (~40 lines) is introduced as a pure helper, then wired into `runOneCell` between `generateBatch` and the existing per-ordinal for-loop. `validateAndInsertWithRetry` gets one optional parameter so attempt 0 of its retry loop can consume the pre-computed result; every other branch is unchanged.

Order: build and unit-test the pool in isolation (Tasks 1–2), then the surgical edit to `validateAndInsertWithRetry` (Tasks 3–4), then the `runOneCell` integration (Task 5), then the integration test additions that prove the end-to-end correctness invariants (Task 6).

## Steering Document Compliance

- **tech.md (§2, AI-heavy / cost-controlled):** all tasks stay within the existing TypeScript + Drizzle + Anthropic SDK stack; no new third-party dependency is added (the pool is hand-rolled per the design's rationale). `MAX_VALIDATOR_CONCURRENCY` is the only knob, documented with the rate-limit + Lambda-concurrency rationale.
- **CLAUDE.md "Testing" gate:** every task ships its tests in the same atomic unit and runs `pnpm lint && pnpm typecheck && pnpm test` from the repo root as its definition of done. No task is "complete" until those exit 0.
- **CLAUDE.md "Don't add backwards-compat shims":** all edits are direct. The `precomputedFirstValidation` parameter is optional only so the integration test can exercise both branches; production callers always pass it.

## Atomic Task Requirements

Each task touches 1–2 files, is completable in 15–30 minutes, has one testable outcome, and references the exact files plus the requirements/design sections it traces to.

## Tasks

- [x] 1. Create the bounded worker pool in `packages/db/src/generation/validator-pool.ts`
  - File: `packages/db/src/generation/validator-pool.ts` (new)
  - Implement `runValidatorPool(opts): Promise<Map<number, { result, tokenUsage }>>` per the design's Component 1 sketch. Single exported function; no class. ~40 lines.
  - Argument shape: `{ drafts: readonly ExerciseDraft[]; client: Anthropic; spec: GenerationSpec; signal?: AbortSignal; concurrency: number }`.
  - Behavior: throw synchronously if `concurrency < 1`; clamp worker count to `Math.min(concurrency, drafts.length)`; workers pull ordinals from a shared `nextOrdinal++` counter; check `signal?.aborted` at the top of each iteration; write each completed result into the result Map keyed by ordinal; rejection of `Promise.all` on the first worker throw.
  - Add the inline comment from the design explaining why `nextOrdinal++` is race-free in single-threaded JS.
  - Purpose: provide the pure orchestration primitive that Phase A will call into.
  - _Leverage: `packages/ai/src/validate.ts` (exports `validateDraft`), `packages/ai/src/cost-model.ts` (exports `ClaudeUsageBreakdown` via `@language-drill/ai`)_
  - _Requirements: 1.1, 1.2, 1.4, 5.1_

- [x] 2. Add unit tests for the worker pool in `packages/db/src/generation/validator-pool.test.ts`
  - File: `packages/db/src/generation/validator-pool.test.ts` (new)
  - Pure unit tests — no DB, no env vars, no real Anthropic client. Mock `validateDraft` via `vi.mock` to record call timestamps and return shaped-by-ordinal results.
  - Cover all 9 cases from the design's Testing Strategy: (1) concurrency=1 serial, (2) concurrency=5 overlap observed, (3) ordinal-keying under out-of-order completion, (4) first-error rejects the pool, (5) pre-aborted signal rejects with the SIGINT message, (6) mid-flight abort rejects within one call-latency, (7) `concurrency > drafts.length` clamps worker count, (8) `concurrency < 1` throws synchronously, (9) token usage forwarded into the result map per call.
  - Purpose: prove the pool's correctness invariants in isolation so the integration tests later can focus on aggregation semantics rather than re-proving concurrency primitives.
  - _Leverage: existing `vi.mock` patterns in `packages/ai/src/generate.test.ts`_
  - _Requirements: 1.1, 1.2, 1.4, 3.1, 4.1, 4.2, 4.3, 5.1_

- [x] 3. Add `MAX_VALIDATOR_CONCURRENCY` constant to `packages/db/src/generation/run-one-cell.ts`
  - File: `packages/db/src/generation/run-one-cell.ts` (modify)
  - Add a top-of-file `const MAX_VALIDATOR_CONCURRENCY = 5;` with the doc comment from the design's Component 3 section (mentions Anthropic Sonnet 4.6 org-tier RPM, Lambda `reservedConcurrency: 3`, rollback knob at value 1, and the `docs/tech-debt.md` cross-reference).
  - Add import for `runValidatorPool` from `./validator-pool` (will be consumed in Task 5).
  - Purpose: establish the named-constant + import that subsequent tasks reference. No runtime behaviour change yet.
  - _Leverage: existing `const MAX_DEDUP_RETRIES = 3;` pattern in the same file as a formatting template_
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 4. Thread `precomputedFirstValidation` through `validateAndInsertWithRetry` in `packages/db/src/generation/run-one-cell.ts`
  - File: `packages/db/src/generation/run-one-cell.ts` (continue from Task 3)
  - Extend `ValidateAndInsertOpts` (opens at line 166) with one optional field per the design's Component 2 delta: `precomputedFirstValidation?: { result: ValidateDraftResult; tokenUsage: ClaudeUsageBreakdown }`.
  - Edit the `validateDraft` call inside the `for (let attempt = 0; …)` loop (loop opens at line 195; call at line 202) so that when `attempt === 0 && opts.precomputedFirstValidation` the function destructures from the precomputed value instead of calling `await validateDraft(...)`. The `extraUsage = addUsage(extraUsage, valUsage); validatedCount++;` lines and everything below stay identical.
  - Critically: attempts 1+ (dedup-retry path) must always call `validateDraft` live. Verify this is preserved.
  - Purpose: enable Phase A's pre-computed first validation to be consumed by the existing retry loop without duplicating the work.
  - _Leverage: existing `validateAndInsertWithRetry` body (`run-one-cell.ts:183-317`), `addUsage` from `@language-drill/ai`_
  - _Requirements: 2.1, 2.3, 3.1, 3.2_

- [x] 5. Wire Phase A into `runOneCell` in `packages/db/src/generation/run-one-cell.ts`
  - File: `packages/db/src/generation/run-one-cell.ts` (continue from Tasks 3–4)
  - Between the existing `generateBatch` call (line 393) plus the all-malformed-batch throw (line 412) and the per-ordinal for-loop (line 416), insert one `await runValidatorPool({ drafts: batch.drafts, client, spec, signal, concurrency: MAX_VALIDATOR_CONCURRENCY })` call and bind the result to a `const firstValidations`.
  - In the existing for-loop (line 416), pass `precomputedFirstValidation: firstValidations.get(ordinal)` into the `validateAndInsertWithRetry` call. Every other arg stays the same.
  - Verify the existing outer `try/catch` already wraps the new call — any pool throw flows into `failClosed` with the existing semantics. No new error-handling code.
  - Purpose: switch the production code path to two-phase orchestration. After this task, a fresh cell run uses parallel first-validation; dedup retries stay sequential.
  - _Leverage: existing `runOneCell` body, `MAX_VALIDATOR_CONCURRENCY` from Task 3, `runValidatorPool` from Task 1, `precomputedFirstValidation` param from Task 4_
  - _Requirements: 1.1, 1.3, 3.1, 3.2, 3.3, 4.3, 5.2_

- [x] 6. Add integration-suite assertions to `packages/db/src/generation/run-one-cell.test.ts`
  - File: `packages/db/src/generation/run-one-cell.test.ts` (modify; existing suite is gated on `TEST_DATABASE_URL`, no new gate)
  - Add four new `it` cases inside the existing top-level describe block (mock-client-driven, no live Claude):
    - (a) **No double-validation on attempt 0:** generate-and-run a 10-draft spec; assert the mock client's `validateDraft` call counter equals `drafts.length` (10) plus the number of dedup retries observed (typically 0–2 with the existing cloze fixtures). Asserts the precomputed value is consumed instead of a second live call.
    - (b) **Dedup retry still triggers a live validateDraft (pre-existing-row collision):** seed the cell's `exercises` table with a row whose `_dedupKey` matches `canonicalSurface(CLOZE_FIXTURES[0])` before invoking `runOneCell`; assert `validateDraft`'s invocation count = 10 (Phase A) + ≥ 1 (live retry), and assert `firstAttemptSkippedCount >= 1`. Proves the dedup-retry path is live for attempts 1+.
    - (c) **Parallel-draft canonical-surface collision resolves to exactly one INSERT (Requirement 2.2):** point `MOCK_CLAUDE_FIXTURES_DIR` at a temp directory containing a 2-entry `claude-generation/cloze.json` where both fixtures produce the same `canonicalSurface` (e.g. identical sentence after lowercase + diacritic-strip). The mock client cycles by `ordinal % fixtures.length`, so ordinals 0 and 1 will both have the same canonical surface. Both validate independently in Phase A; assert exactly one row lands in `exercises` for that surface (`onConflictDoNothing` semantics preserved), and assert the second draft entered the retry-generate path (`firstAttemptSkippedCount === 1`). Pattern: `generate-exercises-mock-client.ts:30` already documents this temp-dir override mechanism.
    - (d) **All-malformed batch fail-closes before Phase A:** mock `generateBatch` to return `{ drafts: [], malformedDrafts: [{ ordinal: 0, errorMessage: '…' }], tokenUsage }`; assert `runValidatorPool` is **not** invoked (e.g. via the mock counter staying at 0) and the audit row is `status='failed'` per PR #87's existing path.
  - Re-run the existing happy-path integration tests; their `insertedCount`, `approvedCount`, `flaggedCount`, `rejectedCount`, `dedupGivenUpCount`, and `tokenUsage` assertions MUST still pass — proves aggregation correctness under parallelism (Requirement 3.1–3.3).
  - Purpose: lock in the end-to-end correctness invariants the design promises.
  - _Leverage: existing `runOneCell.test.ts` describe block, `createMockAnthropicClient` from `packages/db/scripts/generate-exercises-mock-client.ts`, `CLOZE_FIXTURES` already defined in the test file, `canonicalSurface` already imported from `@language-drill/ai`_
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_
