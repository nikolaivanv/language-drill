# Design Document

## Overview

Convert the per-draft validation loop in `runOneCell` from strictly sequential to bounded-parallel via a two-phase orchestration:

1. **Phase A — parallel first-validations.** A small worker pool (cap = `MAX_VALIDATOR_CONCURRENCY`, default 5) dispatches each draft's first `validateDraft` call concurrently. Workers pull ordinals from a shared atomic counter, observe the existing `AbortSignal` between iterations, and write results into an ordinal-keyed `Map`.
2. **Phase B — sequential routing + INSERT + dedup-retry, as today.** The existing `validateAndInsertWithRetry` gets a new optional `precomputedFirstValidation` parameter; when supplied, attempt 0 of its retry loop uses the pre-computed result instead of calling `validateDraft` again. Attempts 1+ (dedup retries) keep their existing live-call behaviour. The for-loop over ordinals in `runOneCell` is unchanged — same per-ordinal aggregation into `CellResult` counters.

This isolates parallelism to the slowest serial segment (the 50× sequential validator calls, ~250–400 s of wall-clock) while preserving every other invariant: dedup-retry semantics, abort signal latency, token-usage accounting, audit-row shape, CLI output, and the just-shipped loss-tolerance (PR #87) — all unchanged.

## Steering Document Alignment

### Technical Standards (tech.md)

- **Serverless-first / cost-controlled (§1)**: shorter wall-clock means cells fit inside the 900 s Lambda timeout with comfortable headroom, eliminating today's silent-timeout failure mode and the zombie-audit-row recovery toil. No new infrastructure, no new persistent state, no new IAM permissions.
- **AI-heavy / pre-generated content pool (§1)**: keeps the "scheduler quietly refills the pool overnight" property intact by removing the wall-clock cliff that breaks it.
- **TypeScript / Hono / Drizzle stack (§2)**: design uses only `Promise` primitives and `AbortController`/`AbortSignal` from the standard runtime. No new third-party dependency is introduced — a hand-rolled bounded worker pool (~40 lines) replaces the temptation to pull in `p-limit`. This matches the project's existing preference (visible across `packages/db/src/generation/*`) for small in-repo primitives over external libs.
- **Cost-controlled / org-tier rate limits**: the cap is a single named constant (`MAX_VALIDATOR_CONCURRENCY`) documented to be re-tuned if Anthropic 429s start appearing. Default 5 stays comfortably below the org-tier RPM ceiling at Lambda `reservedConcurrency: 3` (i.e. up to 15 in-flight validator calls across all generation Lambdas).

### Project Structure

The repo doesn't have a dedicated `structure.md`; conventions are derivable from existing code. New file lives next to its consumer:

- `packages/db/src/generation/validator-pool.ts` — the bounded worker pool (new).
- `packages/db/src/generation/validator-pool.test.ts` — pure unit tests, no DB needed (new).
- `packages/db/src/generation/run-one-cell.ts` — modified: adds the Phase A call site and threads `precomputedFirstValidation` through `validateAndInsertWithRetry`.

No new export surface from `@language-drill/db`'s `index.ts` — the worker pool is internal to the generation module.

## Code Reuse Analysis

### Existing Components to Leverage

- **`validateDraft` (`packages/ai/src/validate.ts:256`)**: the unit of work the pool dispatches. **Unchanged signature.** Existing token-usage shape (`ClaudeUsageBreakdown`) flows through the pool's result `Map` and continues to be aggregated by `addUsage` in `runOneCell`.
- **`AbortSignal` plumbing (`run-one-cell.ts:131-138, 189, 194, 383, 388, 399`)**: existing cooperative-cancellation pattern (`if (signal?.aborted) throw new Error('Aborted by user (SIGINT)')`) is mirrored verbatim inside the worker loop. No new cancellation primitive; same SIGINT error message; same outer-catch `failClosed` semantics. The CLI's existing SIGINT → AbortController bridge keeps working.
- **`validateAndInsertWithRetry` (`run-one-cell.ts:183-317`)**: extended with one new optional parameter `precomputedFirstValidation?: { result: ValidateDraftResult; tokenUsage: ClaudeUsageBreakdown }`. When present, the first iteration of the existing `for (let attempt = 0; …)` loop skips the inline `validateDraft` call and uses the pre-computed value; attempts 1+ (dedup retries) call `validateDraft` live as today. Existing tests covering the dedup-retry paths continue to pass because retry semantics are unchanged.
- **`routeValidationResult` (`./routing`)**: unchanged. Both Phase A's pre-computed result and Phase B's retry-generation results flow through it.
- **`runRetryGeneration` (`run-one-cell.ts:150-164`)**: unchanged. Dedup retries still call `generateBatch` for a single replacement draft, sequentially.
- **`addUsage` (`@language-drill/ai`)**: unchanged. Used to aggregate Phase A's per-call usages into the running `combinedUsage` in `runOneCell`.
- **PR #87's loss-tolerance** (`packages/ai/src/generate.ts:541-602`): unaffected. `generateBatch` runs *before* this design's Phase A; malformed-draft handling already happened. Phase A only sees successfully-generated drafts.

### Integration Points

- **`runOneCell`'s outer `try/catch`** (`run-one-cell.ts:382-475`): Phase A's worker pool throws on first error (network, 429, or SIGINT). The throw propagates out of `Promise.all`, is caught by the existing outer `try/catch`, and flows into `failClosed` with the existing error-message shape. **No new error-handling surface.**
- **`CellResult` shape**: unchanged. Counters and timing semantics are identical; only the `durationMs` numeric value drops.
- **CloudWatch structured logs** (Lambda's `handler.ts` → `summarizeResult`): unchanged. Already surfaces `malformedDrafts` (PR #87), `inserted`, `approved`, `flagged`, `rejected`, `dedupGivenUp`, `durationMs`. No new fields.
- **CLI line** (`generate-exercises.ts:147-168`): unchanged.
- **Lambda's `SqsEventSource` and `reservedConcurrency: 3`** (PR #76): unchanged. With `MAX_VALIDATOR_CONCURRENCY = 5` per Lambda and `reservedConcurrency = 3`, the system tops out at ~15 in-flight validator calls across all running cells — well under the Anthropic Sonnet 4.6 org-tier RPM.

## Architecture

```mermaid
sequenceDiagram
    participant RC as runOneCell
    participant GB as generateBatch
    participant VP as validator-pool (NEW)
    participant VD as validateDraft
    participant VI as validateAndInsertWithRetry

    Note over RC,GB: existing — unchanged
    RC->>GB: produce N drafts
    GB-->>RC: { drafts, tokenUsage, malformedDrafts }

    Note over RC,VP: Phase A — NEW
    RC->>VP: runValidatorPool(drafts, signal, cap=5)
    par
      VP->>VD: validateDraft(drafts[0])
      VD-->>VP: { result, tokenUsage }
    and
      VP->>VD: validateDraft(drafts[1])
      VD-->>VP: { result, tokenUsage }
    and
      VP->>VD: validateDraft(drafts[2..N], queued)
      VD-->>VP: { result, tokenUsage } each
    end
    VP-->>RC: Map<ordinal, { result, tokenUsage }>

    Note over RC,VI: Phase B — sequential per ordinal (existing, +1 param)
    loop for each ordinal
      RC->>VI: validateAndInsertWithRetry({draft, precomputedFirstValidation})
      Note over VI: attempt 0 uses precomputed; attempts 1+ (dedup retries) call validateDraft live as today
      VI-->>RC: DraftOutcome (terminalStatus + extraUsage + …)
    end

    Note over RC: aggregate counters → CellResult (unchanged shape)
```

The two phases share the same `AbortSignal`. Worker pool latency on abort is bounded by one in-flight `validateDraft` call (~5–8 s) — same as today's per-iteration abort check on the serial loop.

## Components and Interfaces

### Component 1 — `runValidatorPool` (new)

**File:** `packages/db/src/generation/validator-pool.ts`

- **Purpose:** Run `validateDraft` for each draft with bounded parallelism. Pure orchestration — no DB access, no business logic, no per-ordinal state machine.
- **Interfaces:**
  ```ts
  export async function runValidatorPool(opts: {
    drafts: readonly ExerciseDraft[];
    client: Anthropic;
    spec: GenerationSpec;
    signal?: AbortSignal;
    concurrency: number;
  }): Promise<Map<number, { result: ValidateDraftResult; tokenUsage: ClaudeUsageBreakdown }>>
  ```
  Result keyed by ordinal (the draft's index in the input array). Pool throws on the first worker error (network, 429, SIGINT). On throw, in-flight calls drain; no new calls are dispatched.
- **Dependencies:** `validateDraft` (from `@language-drill/ai`), nothing else. No DB client, no env access.
- **Reuses:**
  - `validateDraft`'s exact existing signature.
  - The project's existing AbortSignal pattern (top-of-iteration check + throw).
- **Internal shape (sketch, ~40 lines):**
  ```ts
  export async function runValidatorPool({ drafts, client, spec, signal, concurrency }) {
    if (concurrency < 1) throw new Error('concurrency must be >= 1');
    const results = new Map<number, { result; tokenUsage }>();
    let nextOrdinal = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (signal?.aborted) throw new Error('Aborted by user (SIGINT)');
        // JS is single-threaded — `nextOrdinal++` and the bound check both
        // resolve before any `await`, so no two workers ever read the same
        // ordinal even with N workers contending. Same property is what lets
        // `Map.set(ordinal, …)` skip locking.
        const ordinal = nextOrdinal++;
        if (ordinal >= drafts.length) return;
        const { result, tokenUsage } = await validateDraft(client, drafts[ordinal], spec);
        results.set(ordinal, { result, tokenUsage });
      }
    };

    const workerCount = Math.min(concurrency, drafts.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
  }
  ```

### Component 2 — `validateAndInsertWithRetry` (modified)

**File:** `packages/db/src/generation/run-one-cell.ts` (extending the existing 134-line function)

- **Purpose:** Same as today — route a draft through validation, insert with dedup, retry-generate on dedup conflict, return terminal status. Behaviour change: skip the first inline `validateDraft` call when a pre-computed result is supplied.
- **Interfaces (delta):**
  ```ts
  type ValidateAndInsertOpts = {
    // ... existing fields unchanged ...
    /**
     * Phase A pre-computed first validation. When supplied, attempt 0 of the
     * retry loop uses this instead of calling validateDraft. Attempts 1+
     * (dedup retries) still call validateDraft live.
     */
    precomputedFirstValidation?: {
      result: ValidateDraftResult;
      tokenUsage: ClaudeUsageBreakdown;
    };
  };
  ```
- **Dependencies:** unchanged.
- **Reuses:** the existing `for (let attempt = 0; attempt <= MAX_DEDUP_RETRIES; attempt++)` loop and every branch inside it. The only edit is at the top of the loop body — replace the inline `validateDraft` call when `attempt === 0 && opts.precomputedFirstValidation`.
- **Edit detail (in pseudocode):**
  ```ts
  // before:
  const { result, tokenUsage: valUsage } = await validateDraft(opts.client, currentDraft, opts.spec);
  // after:
  let result: ValidateDraftResult;
  let valUsage: ClaudeUsageBreakdown;
  if (attempt === 0 && opts.precomputedFirstValidation) {
    ({ result, tokenUsage: valUsage } = opts.precomputedFirstValidation);
  } else {
    ({ result, tokenUsage: valUsage } = await validateDraft(opts.client, currentDraft, opts.spec));
  }
  ```
  Everything after this point — `extraUsage = addUsage(...)`, `validatedCount++`, routing decision, INSERT, dedup-retry — is byte-identical.

### Component 3 — `runOneCell` integration (modified)

**File:** `packages/db/src/generation/run-one-cell.ts`

- **Purpose:** Wire Phase A into the existing per-cell flow between `generateBatch` and the per-ordinal for-loop.
- **Interfaces:** unchanged (`RunOneCellInput` and `CellResult` are the same).
- **Edit detail (in pseudocode):**
  ```ts
  // ... existing generateBatch + malformed handling ...

  // Phase A — NEW: parallel first-validation. The pool throws into the outer
  // try/catch on the first failure (network, 429, SIGINT), preserving the
  // existing failClosed behaviour.
  const firstValidations = await runValidatorPool({
    drafts: batch.drafts,
    client,
    spec,
    signal,
    concurrency: MAX_VALIDATOR_CONCURRENCY,
  });

  // Phase B — existing for-loop, plus one new arg into validateAndInsertWithRetry.
  for (let ordinal = 0; ordinal < batch.drafts.length; ordinal++) {
    // ... existing signal check ...
    const outcome = await validateAndInsertWithRetry({
      // ... existing args ...
      precomputedFirstValidation: firstValidations.get(ordinal),
    });
    // ... existing aggregation switch unchanged ...
  }
  ```
- **New constant** (same file, top-of-file):
  ```ts
  /**
   * Cap on concurrent `validateDraft` calls per cell. Tuned against:
   * (a) Anthropic Sonnet 4.6 org-tier RPM — at Lambda reservedConcurrency=3
   *     and this cap=5, we top out at ~15 in-flight validator calls across
   *     all cells, comfortably under the org-tier ceiling.
   * (b) Setting this to 1 makes runOneCell byte-identical to the pre-spec
   *     serial loop — useful as an emergency rollback knob.
   * See docs/tech-debt.md "Per-draft validation loop" entry for the broader
   * context (generation loop is still serial; spec covers validator only).
   */
  const MAX_VALIDATOR_CONCURRENCY = 5;
  ```

## Data Models

No schema changes. No new persisted state. The Phase A `Map<ordinal, { result, tokenUsage }>` is purely in-memory inside `runOneCell` and is discarded after the per-ordinal for-loop consumes it.

`ValidateDraftResult` and `ClaudeUsageBreakdown` are pre-existing types from `@language-drill/ai`; this design uses them unchanged.

## Error Handling

### Error Scenarios

1. **Anthropic 429 / network error on a single validator call.**
   - **Handling:** The worker's `await validateDraft(...)` rejects. The rejection propagates out of the worker's `for` loop. `Promise.all` rejects. The outer `try/catch` in `runOneCell` enters `failClosed`. Cell ends with `status='failed'`, audit row updated, errorMessage carried through. Same shape as today's behaviour when a serial `validateDraft` call throws.
   - **User Impact:** None directly. CloudWatch shows `cell terminal-failed` with the Anthropic error message. Daily scheduler will re-enqueue the cell on its next run.
   - **Note:** Other in-flight workers complete or are abandoned when Node tears down the pool. There's no zombie audit row because `failClosed` always writes status='failed' (PR #71 + #79 territory unaffected).

2. **SIGINT during Phase A (CLI use case).**
   - **Handling:** CLI's signal handler aborts the existing `AbortController`. Workers' top-of-iteration check fires, the worker throws `'Aborted by user (SIGINT)'`. `Promise.all` rejects. Outer catch → `failClosed`. Same error message as today.
   - **User Impact:** CLI exits cleanly within ~5–8 s (one in-flight `validateDraft` worth) of pressing Ctrl+C. Today's serial-loop latency is the same.

3. **Two parallel drafts produce the same canonical surface.**
   - **Handling:** Both validate independently in Phase A. Phase B runs sequentially — draft A inserts first, draft B's INSERT returns empty (`onConflictDoNothing`), draft B enters the existing retry-generate path. Eventually one of: `dedup-given-up` (after 3 retries) or `first-attempt-dedup-then-success`. **Identical to today's serial behaviour at the row level.**
   - **User Impact:** None.

4. **`MAX_VALIDATOR_CONCURRENCY > drafts.length`.**
   - **Handling:** `Math.min(concurrency, drafts.length)` clamps the actual worker count. No-op edge case.
   - **User Impact:** None.

5. **`drafts.length === 0` (all-malformed cell from PR #87).**
   - **Handling:** Already handled in `runOneCell` *before* this design's Phase A call — `runOneCell` throws "All N drafts malformed" before reaching the pool. Pool is never invoked. No new code path.
   - **User Impact:** Unchanged from PR #87 behaviour.

6. **Pool throws but some workers have already started a `validateDraft` call.**
   - **Handling:** `Promise.all` rejects on first throw. In-flight `validateDraft` calls drain in the background; their resolved values may still call `results.set(ordinal, …)` before Node tears the closure down, but `runOneCell` has already exited the `await` of `runValidatorPool` and never consumes them — `failClosed` runs against the partial state. Cost-only impact: we pay for whatever calls were already in flight (~ up to `concurrency - 1` extra calls). Acceptable.
   - **User Impact:** None.

## Testing Strategy

### Unit Testing

**New file:** `packages/db/src/generation/validator-pool.test.ts` (pure unit tests — no DB, no env, no live Claude).

Cases:
1. **Concurrency=1 produces serial behaviour.** Mock `validateDraft` records call start/end timestamps; assert no two calls overlap; assert results map has all ordinals in order.
2. **Concurrency=5 produces overlap.** Same mock; assert at least two calls' time windows overlap; assert all ordinals are present in the result map.
3. **Result-map keying is ordinal-correct under out-of-order completion.** Mock returns shaped-by-ordinal data with artificial delays so completions interleave; assert the map correctly associates ordinal → expected result.
4. **First worker error rejects the pool.** Mock throws on ordinal=3; assert pool rejects with that error; assert no result is recorded for ordinals 3+ (4 may or may not have started — both acceptable).
5. **AbortSignal pre-set on call → pool rejects with the SIGINT message.**
6. **AbortSignal triggered mid-flight → pool rejects within one validator-call's latency.**
7. **`concurrency > drafts.length` clamps to `drafts.length` workers.** Assert `validateDraft` is called exactly `drafts.length` times.
8. **`concurrency < 1` throws synchronously.** Pre-pool guard.
9. **Token usage from each mocked call appears in the result map's `tokenUsage` field.** Aggregation correctness sentinel (no double-count, no skip).

**Updates to existing file:** `packages/db/src/generation/run-one-cell.test.ts` (already gated on `TEST_DATABASE_URL`; needs no new gate). Add cases:
10. **Pre-computed first validation is consumed; no live call is issued on attempt 0.** Mock client's `validateDraft` count = drafts.length (Phase A) + retry calls only. Critically: not 2×drafts.length.
11. **Dedup-retry still calls `validateDraft` live for attempts 1+.** Test scenario: force a dedup collision on draft 0's first INSERT, assert validateDraft is invoked one extra time (attempt 1) live.
12. **All-malformed batch from PR #87 still fail-closes before Phase A.** Asserts Phase A is not invoked when `batch.drafts.length === 0`.

### Integration Testing

The existing `run-one-cell.test.ts` integration suite (gated on `TEST_DATABASE_URL`) exercises end-to-end through a real Neon connection + a mock Anthropic client. With the changes:

- Re-run the existing happy-path tests (5–10 of them, depending on git state at PR time). Their `insertedCount`, `approvedCount`, `flaggedCount`, `rejectedCount`, `dedupGivenUpCount`, and `tokenUsage` assertions must still pass — proves correctness of aggregation under parallelism.
- Add one new test (gated): a 10-draft spec runs end-to-end with `MAX_VALIDATOR_CONCURRENCY = 3`, asserts the `validateDraft` mock observed parallel call overlap (using its existing recorded-timestamp instrumentation if present, or a new instrumentation if not), and the final `CellResult` matches the serial-run expected outcome on the same fixture.

### End-to-End Testing

Lambda-level E2E is provided implicitly by the existing scheduler → SQS → Lambda → DB pipeline. After deployment, **one observation post-merge is sufficient**:

- Trigger the daily scheduler manually (or wait for 04:00 UTC) on a previously-zombie-prone cell (e.g. `tr-a2-everyday-vocab` or `es-b2-abstract-noun-vocab`).
- Observe the `cell succeeded` CloudWatch line: expect `durationMs ≈ 60_000–120_000` instead of the previously-observed 325–400+ s range.
- Confirm `generation_jobs` row reflects expected `approved_count` + `flagged_count` + `rejected_count` for the cell.

No web UI affected. No new HTTP endpoints. No new infrastructure CDK changes.
