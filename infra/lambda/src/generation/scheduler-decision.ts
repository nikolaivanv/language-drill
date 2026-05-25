/**
 * Pure scheduler-decision logic — extracted from `scheduler.ts` (Phase 4) so
 * the R1 + R6 enqueue/suppress decision is unit-testable in isolation. No
 * imports from `@aws-sdk/*`, no Drizzle, no env reads. Pure inputs → pure
 * output.
 *
 * The handler in `scheduler.ts` is responsible for the AWS-SDK / Drizzle /
 * env-touching code (loading recent jobs, building messages, sending SQS
 * batches, logging); this module owns the policy of whether each cell
 * should be enqueued and, if not, why.
 *
 * Precedence (highest first), per R6.3:
 *   1. C2 / not-in-Round-1 → `skip-c2` (Round-1 narrowing per Req 4.5)
 *   2. approvedInPool ≥ target → `skip-target-reached`
 *   3. Curriculum-version mismatch → clears suppression → `enqueue` (R6.4)
 *   4. Predictive saturation (near target + dedup-heavy last run) →
 *      `skip-saturated-dedup` on the same tick (R4.1)
 *   5. Saturated-dedup (reactive: low approved + dedup-heavy) →
 *      `skip-saturated-dedup` (R6.2; beats low-yield)
 *   6. Low-yield → `skip-low-yield` (R1.4)
 *   7. Otherwise → `enqueue` with `need = target - approvedInPool`
 *
 * R3: the per-cell `target` is supplied by the caller (`resolveCellTarget` in
 * `cell-targets.ts`) rather than read from the global `TARGET_PER_CELL`, so a
 * narrow A1/A2 cell tops up to a reachable number instead of grinding 50.
 * `TARGET_PER_CELL` remains the resolver's fallback (and the historical default
 * many tests pass through), so passing it reproduces the pre-R3 behavior.
 */

import { ROUND_1_CEFR_LEVELS, type Cell } from '@language-drill/db';

// ---------------------------------------------------------------------------
// Constants (exported so callers and tests can reference them)
// ---------------------------------------------------------------------------

/** Target approved-exercise count per cell. The scheduler enqueues until each
 *  cell reaches this many auto-approved / manual-approved rows. */
export const TARGET_PER_CELL = 50;

/**
 * R1.4 — a cell whose most recent succeeded job produced fewer than this many
 * net new approved exercises is treated as low-yield and skipped on the next
 * tick (until the curriculum version changes per R6.4). Prevents the per-cell
 * daily Claude spend from being eaten by cells that can no longer make
 * material progress.
 */
export const LOW_YIELD_THRESHOLD = 3;

/**
 * R6.1 — a job is `saturated-dedup` when `dedupGivenUpCount` is at least
 * `ceil(SATURATED_DEDUP_REQ_FRACTION * requestedCount)` AND `approvedCount`
 * is below `ceil(SATURATED_DEDUP_APPROVED_FRACTION * requestedCount)`. Both
 * counters already live on `generation_jobs`; no schema change needed for
 * the detection itself.
 */
export const SATURATED_DEDUP_REQ_FRACTION = 0.5;
export const SATURATED_DEDUP_APPROVED_FRACTION = 0.3;

/**
 * R4.1 — predictive saturation margin. The predictive-suppression branch treats
 * a cell as "near its ceiling" when its remaining `need` is within this fraction
 * of the resolved target. Combined with a dedup-heavy most-recent run (reusing
 * the `SATURATED_DEDUP_REQ_FRACTION` dedup-ratio threshold), that's enough to
 * suppress the cell on the SAME tick — unlike the reactive saturated-dedup
 * branch, it does NOT require that run to have been fully wasteful (low
 * approved). Design-tunable.
 */
export const PREDICTIVE_SATURATION_MARGIN_FRACTION = 0.2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The columns the scheduler reads from the most recent succeeded job for a
 * given cell. Populated by a `SELECT DISTINCT ON (cell_key) ... ORDER BY
 * cell_key, started_at DESC` query in `scheduler.ts`.
 */
export type RecentJob = {
  approvedCount: number;
  requestedCount: number;
  dedupGivenUpCount: number;
  /** `text` column on `generation_jobs`; NULL on legacy rows pre-migration. */
  curriculumVersion: string | null;
  finishedAt: Date;
};

export type EnqueueDecision =
  | { kind: 'enqueue'; need: number }
  | { kind: 'skip-target-reached' }
  | { kind: 'skip-low-yield' }
  | { kind: 'skip-saturated-dedup' }
  | { kind: 'skip-c2' };

// ---------------------------------------------------------------------------
// decideEnqueue
// ---------------------------------------------------------------------------

/**
 * Decide whether the scheduler should enqueue a generation job for this cell.
 *
 * @param cell                     The curriculum cell under consideration.
 * @param approvedInPool           Current count of auto-approved + manual-
 *                                 approved exercises in the cell. Looked up
 *                                 from the existing `exercises` aggregate.
 * @param target                   The resolved per-cell target (R3) — from
 *                                 `resolveCellTarget(cell)`. The cell is
 *                                 topped up to this many approved rows.
 * @param recentJob                The most recent succeeded `generation_jobs`
 *                                 row for this cell, or `null` if none.
 * @param curriculumVersionOnDisk  `CURRICULUM_VERSION_<LANG>` for the cell's
 *                                 language. `undefined` if the constant is
 *                                 missing (safe default: enqueue — never
 *                                 permanently disable a cell on missing
 *                                 metadata).
 * @returns An `EnqueueDecision` discriminated union the handler switches on.
 */
export function decideEnqueue(
  cell: Cell,
  approvedInPool: number,
  target: number,
  recentJob: RecentJob | null,
  curriculumVersionOnDisk: string | undefined,
): EnqueueDecision {
  // 1. Round-1 narrowing (Req 4.5). C1 / C2 curriculum entries are skipped
  //    silently — the consumer Lambda's guard (Req 2.7) is defense-in-depth
  //    on top of this filter.
  if (!(ROUND_1_CEFR_LEVELS as readonly string[]).includes(cell.cefrLevel)) {
    return { kind: 'skip-c2' };
  }

  // 2. Target-reached. R1.3 / R3.4 — the cell already has enough approved
  //    exercises for its resolved per-cell target; no further enqueueing.
  if (approvedInPool >= target) {
    return { kind: 'skip-target-reached' };
  }

  const need = target - approvedInPool;

  // 3. No recent job → no suppression possible → enqueue. This is the
  //    "first run for this cell" path and the most common case during
  //    initial rollout.
  if (recentJob === null) {
    return { kind: 'enqueue', need };
  }

  // 4. Curriculum-version mismatch clears suppression (R6.4). Three sub-cases
  //    all clear suppression:
  //      (a) The curriculum on disk has been bumped since the suppressing
  //          job ran → the new content is worth a fresh attempt.
  //      (b) `curriculumVersionOnDisk === undefined` (constant missing for
  //          this language) → safe-by-default: never permanently disable a
  //          cell on missing metadata.
  //      (c) `recentJob.curriculumVersion === null` (legacy row written
  //          before the column existed) → treat NULL as "older than any
  //          known version".
  //
  //    All three reduce to: if the on-disk version differs from the recorded
  //    one (`undefined !== string` is `true`; `null !== string` is `true`),
  //    suppression clears.
  if (curriculumVersionOnDisk === undefined) {
    return { kind: 'enqueue', need };
  }
  if (recentJob.curriculumVersion !== curriculumVersionOnDisk) {
    return { kind: 'enqueue', need };
  }

  // 5. Predictive saturation (R4.1). The cell is within a small margin of its
  //    resolved target AND the most-recent run was dedup-heavy — another run
  //    would mostly collide on the dedup index for little new variety, so
  //    suppress on the SAME tick (reusing `skip-saturated-dedup`). Unlike the
  //    reactive branch below, this does NOT require that run to have been fully
  //    wasteful (low approved): a productive-but-dedup-heavy run on a nearly
  //    full cell still triggers it. Placed AFTER the version-mismatch clears
  //    (step 4) so a curriculum edit still forces a fresh attempt (R4.4), and
  //    uses only fields already on `recentJob` — no new per-cell query (R4.5).
  const predictiveMargin = Math.ceil(
    PREDICTIVE_SATURATION_MARGIN_FRACTION * target,
  );
  const recentDedupHeavy =
    recentJob.requestedCount > 0 &&
    recentJob.dedupGivenUpCount >=
      Math.ceil(SATURATED_DEDUP_REQ_FRACTION * recentJob.requestedCount);
  if (need <= predictiveMargin && recentDedupHeavy) {
    return { kind: 'skip-saturated-dedup' };
  }

  // 6. Saturated-dedup detection (R6.1 + R6.2). Takes precedence over
  //    low-yield per R6.3 — it carries strictly more diagnostic information
  //    (says *why* the cell couldn't make progress, not just that it didn't).
  //    Requires `requestedCount > 0` so the ceil-fraction comparisons are
  //    meaningful; a job with requestedCount=0 doesn't trigger this branch.
  const isSaturatedDedup =
    recentJob.requestedCount > 0 &&
    recentJob.dedupGivenUpCount >=
      Math.ceil(SATURATED_DEDUP_REQ_FRACTION * recentJob.requestedCount) &&
    recentJob.approvedCount <
      Math.ceil(SATURATED_DEDUP_APPROVED_FRACTION * recentJob.requestedCount);
  if (isSaturatedDedup) {
    return { kind: 'skip-saturated-dedup' };
  }

  // 7. Low-yield (R1.4). The recent job produced fewer than
  //    LOW_YIELD_THRESHOLD net new approved exercises — the cell is stuck.
  if (recentJob.approvedCount < LOW_YIELD_THRESHOLD) {
    return { kind: 'skip-low-yield' };
  }

  // 8. Default: enqueue.
  return { kind: 'enqueue', need };
}
