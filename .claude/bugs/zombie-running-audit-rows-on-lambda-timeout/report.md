# Bug Report

## Bug Summary

When a generation cell exceeds the Lambda execution timeout (900 s as of PR #71), AWS hard-kills the Lambda mid-cell without giving `runOneCell` a chance to finalize its `generation_jobs` audit row. The row stays at `status = 'running'` forever. The handler's idempotency guard (`infra/lambda/src/generation/job-message.ts:194-212`) then **refuses to re-run the cell on subsequent SQS deliveries** — it sees `running`, classifies the state as `in-progress`, defers the message back to the queue. After `maxReceiveCount: 3` deferrals the message lands in the DLQ. The cell is **permanently stuck** until an operator manually deletes the audit row.

Observed live on 2026-05-12: two `vocab_recall` cells (`es:b2:vocab_recall:es-b2-abstract-noun-vocab` and `tr:a2:vocab_recall:tr-a2-everyday-vocab`) zombied this way and required a direct `DELETE FROM generation_jobs WHERE id IN (...)` to unstick.

## Bug Details

### Expected Behavior

When a cell's wall-clock genuinely exceeds the Lambda timeout, the orchestrator should:

1. Detect impending timeout via `context.getRemainingTimeInMillis()` while there's still time.
2. Stop accepting new drafts.
3. **Finalize the audit row** with `status = 'failed'`, `finished_at = now()`, `error_message = 'Soft deadline — approaching Lambda timeout'`.
4. Return cleanly so the handler can ack the message.

The cell becomes "tried-and-failed" — the next scheduled run can take a fresh attempt without an operator touching the database, and the SQS message is properly disposed of instead of cycling to DLQ on a phantom idempotency guard.

### Actual Behavior

`runOneCell` writes `status = 'running'` at start (`run-one-cell.ts:348-354`), runs the serial generation + validation loop, and **only** finalizes the audit row (`status = 'succeeded'` or via `failClosed`) when the loop completes or throws. If AWS forcibly terminates the Lambda runtime in between — which it does at the hard timeout, with no JavaScript-level signal — the audit row stays at `'running'` indefinitely. Subsequent SQS deliveries hit the deferral branch (`job-message.ts:210-211` returns `'in-progress'` for any non-terminal status), `maxReceiveCount` exhausts, and the message DLQs.

### Steps to Reproduce

1. Force any cell to take longer than 900 s. The `vocab_recall` cells `es-b2-abstract-noun-vocab` and `tr-a2-everyday-vocab` did this naturally on 2026-05-12 (50 sequential generation calls + 50 sequential validation calls; some combination of retries pushed wall-clock past 900 s).
2. Observe Lambda CloudWatch: the cell's `START RequestId` appears, then `END` ~900 s later with no `cell succeeded` / `cell terminal-failed` / `Task timed out` (the SDK doesn't always emit the timeout line in time for CloudWatch ingestion).
3. Query `generation_jobs WHERE id = '<jobId>'`: `status = 'running'`, `finished_at = NULL`, `error_message = NULL`. The row is a zombie.
4. Subsequent SQS redeliveries log `"already running; deferring"` (handler.ts:131-140) without re-running. After 3 deferrals → DLQ.

### Environment

- **Version**: branch `main` post-`4b377ac` (PR #76 — `MaximumConcurrency` cap merged). PR #71 had already bumped Lambda timeout from 600 → 900 s.
- **Platform**: AWS Lambda generation handler (`LanguageDrillStack-GenerationLambdaWrapHandler1113-...`), SQS, Drizzle on Neon.
- **Observed jobIds (both deleted manually after observation, but cells remain unproduced)**:
  - `3bd96701-1f34-599d-ba90-e21178633484` — `es:b2:vocab_recall:es-b2-abstract-noun-vocab`, started 2026-05-12 12:45:37 UTC.
  - `97ebfcf9-9937-5417-8119-c7eb29e29df2` — `tr:a2:vocab_recall:tr-a2-everyday-vocab`, started 2026-05-12 13:15:09 UTC.

## Impact Assessment

### Severity

- [ ] Critical
- [x] High
- [ ] Medium
- [ ] Low

A single 900 s overrun makes the cell **unrecoverable** without operator intervention. The daily scheduler will keep enqueueing the same cell (it stays under `MIN_PER_CELL = 25`), each enqueue runs into the same zombie row, defers 3×, and DLQs. Operationally this means a cell that's slightly too slow becomes a permanent operator-action backlog item.

### Affected Users

All users, but only on cells that hit the 900 s boundary. Empirically (2026-05-12 data): `vocab_recall` cells are the most exposed because their per-draft generation seems to run slightly slower (umbrella prompts may produce more verbose drafts). ES B2 and TR A2 `vocab_recall` cells both hit it; cloze and translation cells did not.

### Affected Features

- Generation pipeline durability — any genuinely-slow cell becomes stuck rather than retried.
- Operational toil — requires direct SQL writes on production `generation_jobs` to unstick.
- Pool coverage — affected umbrellas stay below target indefinitely.

## Additional Context

### The current zombie-row recovery (what we just had to do manually)

```sql
BEGIN;
DELETE FROM generation_jobs
WHERE id IN ('3bd96701-...', '97ebfcf9-...')
  AND status IN ('running', 'queued')
RETURNING id, cell_key, status, started_at;
COMMIT;
```

Note that `UPDATE status = 'failed'` is **not** sufficient — the handler treats `failed` as `completed` (`job-message.ts:207-208`) and silently acks the next redelivery without re-running. Only `absent` (row missing) makes the handler call `runOneCell`. Today's manual recovery used `DELETE`.

### Related Issues

- **PR #71** (`d3f3c48`) — raised Lambda timeout from 600 → 900 s. Surfaced this bug: pre-#71 the cell DLQ'd via "Lambda silently killed mid-run + SQS visibility expiry + maxReceiveCount cycling." Post-#71 the cell DLQ's via a different path: "Lambda silently killed mid-run + zombie audit row + handler defers 3×." Different mechanism, same operator-visible symptom (stuck cell).
- **PR #76** (`4b377ac`) — added `ScalingConfig.MaximumConcurrency: 3` to the SQS event source mapping, eliminating poller-pre-fetch phantom DLQs. Does not help this case: the receive count increments here are *real* deliveries to *real* handler invocations, just ones the handler refuses to act on.
- **`docs/tech-debt.md` "Per-draft validation loop"** — root cause of *why* cells exceed 900 s. Parallelizing the generation + validation loops would bring worst-case wall-clock under 900 s and make this bug rarely fire. But "rarely" is not "never" — the soft-deadline fix is the durability story.
- **`.claude/bugs/cloze-empty-correct-answer/`** — different bug, same area. The cloze bug is about a single malformed draft killing the cell *via a real throw* with proper audit-row finalization (`status = 'failed'`); this bug is about cells dying *without any throw at all*, leaving the audit row stuck. Both should land before the next prod incident.

## Initial Analysis

### Suspected Root Cause

`runOneCell` has no awareness of the Lambda execution deadline. The per-draft loop happily plows forward as long as Claude calls keep resolving; whether there's 5 minutes or 5 seconds left in the Lambda context is invisible to it. AWS forcibly terminates the Node.js process at the timeout boundary — no `process.on('beforeExit')`, no `try/finally`, no opportunity for the audit row to be updated.

The handler's idempotency guard is correct in design — it prevents two concurrent Lambdas from double-spending on the same cell — but it has no way to distinguish "actively running right now" from "row says running but the worker is dead." So it conservatively defers, and the SQS redelivery mechanism does the rest of the damage.

### Fix Options

1. **Soft deadline driven by `context.getRemainingTimeInMillis()` (recommended).** Thread the Lambda context through the handler into `runOneCell` via an `AbortSignal`:
   ```ts
   // handler.ts
   const deadlineMs = context.getRemainingTimeInMillis() - 10_000; // 10 s safety margin
   const controller = new AbortController();
   setTimeout(() => controller.abort('soft-deadline'), deadlineMs);
   await runOneCell({ ..., signal: controller.signal });
   ```
   `runOneCell` already accepts `signal?: AbortSignal` (see `run-one-cell.ts:131`) and threads it through the per-draft loop with `if (signal?.aborted) throw new Error(...)` checks. When the signal fires, the current loop iteration throws → `runOneCell`'s outer `try/catch` calls `failClosed` → audit row gets `status = 'failed'`, `error_message = 'Approaching Lambda timeout; finalized before forced termination'`. Cleanly finalized; next redelivery sees `failed`, handler acks; cell becomes a candidate for the next scheduler run.

2. **Stuck-row heuristic in the handler.** Before deferring on `in-progress`, check whether `started_at` is older than the Lambda timeout. If yes, treat the row as a zombie and either delete it (transactional) or update it to `failed` and proceed. Smaller code change but more invasive logic and a race window if two Lambdas hit the heuristic simultaneously.

3. **Both, as belt-and-suspenders.** Option 1 prevents new zombies; option 2 reclaims any zombies that slip past (e.g. Lambda OOMs before the soft deadline triggers).

### Affected Components

- `infra/lambda/src/generation/handler.ts:59-227` — accept `Context` parameter from the SQS event handler signature, construct an `AbortController` per record using `context.getRemainingTimeInMillis()`, pass `signal` into `runOneCell`.
- `packages/db/src/generation/run-one-cell.ts:131,189,194,383,388,399` — already wires `signal` through the loop; verify the soft-deadline abort path correctly hits the `failClosed` branch (it does, via the outer `try/catch` at line 445-456 — the existing `Aborted by user (SIGINT)` test from Phase 4 covers exactly this shape).
- `infra/lambda/src/generation/handler.test.ts` — add a test: handler invoked with a `Context` whose `getRemainingTimeInMillis()` returns `15000` should pass a signal that aborts after ~5 s; mock `runOneCell` to verify it received an `AbortSignal` and that `failClosed` runs.
- `packages/db/src/generation/run-one-cell.test.ts` — add an integration-style test that verifies a signal-driven abort updates the audit row to `'failed'` with the soft-deadline error message.

### Open Questions for `/bug-analyze`

- **Partial-cell exercises**: when the soft deadline fires mid-loop, any drafts already INSERTed into `exercises` remain there (they're each their own transaction, not part of a cell-level transaction). Is that OK? Pro: pool gets some new content even from a failed cell. Con: the `generation_jobs.approved_count` won't reflect them because the loop exits via the catch path. Need to decide whether `failClosed` should bump the count to match `exercises` reality, or whether partial cells should roll back. Suggested: keep the partial inserts (they're valid) but have `failClosed` populate `approved_count`/`flagged_count`/`rejected_count` from the loop-local counters before writing the audit row.
- **Safety margin tuning**: the suggested 10 s above is a guess. Should be tuned against observed `failClosed` latency (DB UPDATE on `generation_jobs` over Neon WS) + a margin for in-flight Claude calls. 5 s might be too tight; 15 s might unnecessarily kill cells that would have finished in time.
- **Should we also implement option 2 (stuck-row heuristic) preemptively?** The soft deadline only catches Lambda timeouts; it doesn't catch OOMs, segfaults, or runtime exits that bypass `setTimeout`. Defense in depth.
