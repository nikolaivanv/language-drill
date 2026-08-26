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
 *   6. Low-yield → `skip-low-yield` (R1.4). Skipped entirely when
 *      `targetSeeded` is true — a coverage-converging vocab cell whose tail
 *      (<=2 uncovered targets) approves <LOW_YIELD_THRESHOLD by construction
 *      must not be suppressed, or the last uncovered targets strand until a
 *      curriculum bump. Saturated-dedup (steps 4-5) still applies as the
 *      real backstop.
 *   7. Otherwise → `enqueue` with `need = target - approvedInPool`
 *
 * R3: the per-cell `target` is supplied by the caller (`resolveCellTarget` in
 * `cell-targets.ts`) rather than read from the global `TARGET_PER_CELL`, so a
 * narrow A1/A2 cell tops up to a reachable number instead of grinding 50.
 * `TARGET_PER_CELL` remains the resolver's fallback (and the historical default
 * many tests pass through), so passing it reproduces the pre-R3 behavior.
 */

import { ROUND_1_CEFR_LEVELS, type Cell } from '@language-drill/db';
import { grammarPointFingerprint } from '@language-drill/shared';
import type { CoverageOutcome } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// Constants (exported so callers and tests can reference them)
// ---------------------------------------------------------------------------

/** Target approved-exercise count per cell. The scheduler enqueues until each
 *  cell reaches this many auto-approved / manual-approved rows. */
export { TARGET_PER_CELL } from '@language-drill/shared';

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
  /**
   * `grammarPointFingerprint` of the point as it stood when this job ran.
   * NULL on rows written before the column existed — those fall back to the
   * old per-language version test exactly once, then carry a fingerprint.
   */
  grammarPointFingerprint: string | null;
  /** The most recent job's per-axis coverage outcome (NULL on legacy rows /
   *  cells with no coverageSpec). Read by the scheduler's coverage controller
   *  for per-(axis,value) give-up, not by `decideEnqueue`. */
  coverageOutcome: CoverageOutcome | null;
  finishedAt: Date;
};

/**
 * Days after which a cell's suppression lapses on its own and the cell gets one
 * fresh attempt, regardless of whether its grammar point changed.
 *
 * Since #703 suppression clears only on a CURRICULUM edit. That is the right
 * primary trigger, but it cannot see the other things that fix a stuck cell —
 * a generation or validation prompt change, a model swap, a widened seed pool,
 * an `acceptableAnswers` policy fix. Before #703 the constant per-language
 * version churn re-released everything nightly and covered those by accident;
 * now nothing would, and a cell suppressed over a long-fixed defect could sit
 * out indefinitely waiting for someone to notice.
 *
 * 30 days trades a bounded retry cost against that: with ~143 cells suppressed
 * on prod it works out to roughly five retried cells a night. Override with
 * `SCHEDULER_SUPPRESSION_LAPSE_DAYS`.
 */
export const SUPPRESSION_LAPSE_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/**
 * Options for `decideEnqueue`'s time-dependent behaviour. Grouped into one bag
 * rather than added as positional parameters — the function already takes six,
 * and both of these are injected only so the decision stays pure and testable.
 */
export type DecideEnqueueOptions = {
  /** Injected clock. Defaults to now. */
  now?: Date;
  /** Defaults to `SUPPRESSION_LAPSE_DAYS`. */
  suppressionLapseDays?: number;
};

export type EnqueueDecision =
  | { kind: 'enqueue'; need: number }
  | { kind: 'skip-target-reached' }
  | { kind: 'skip-low-yield' }
  | { kind: 'skip-saturated-dedup' }
  | { kind: 'skip-c2' };

/**
 * Has this cell's curriculum stayed put since `recentJob` ran?
 *
 * The one definition of "the curriculum changed for THIS cell", shared by
 * `decideEnqueue`'s suppression gate and the scheduler's per-(axis,value)
 * coverage give-up gate. Two copies of this rule drifting apart would be the
 * same class of bug it was written to fix: one gate honouring a give-up while
 * the other silently re-opened it.
 *
 * Compares the point's own content fingerprint, NOT the per-language
 * `CURRICULUM_VERSION_<LANG>` constant — see `decideEnqueue` step 4 and
 * `grammar-point-fingerprint.ts` for why the language-wide test disabled both
 * suppressions in production.
 *
 * Legacy rows (fingerprint NULL, written before the column existed) fall back
 * to the version test, so they clear at most once and the job that results
 * records a fingerprint.
 */
export function curriculumUnchangedForCell(
  recentJob: Pick<RecentJob, 'curriculumVersion' | 'grammarPointFingerprint'>,
  cell: Cell,
  curriculumVersionOnDisk: string | undefined,
): boolean {
  // Missing constant is a metadata problem, not a content one: never let it
  // hold a cell suppressed.
  if (curriculumVersionOnDisk === undefined) return false;
  if (recentJob.grammarPointFingerprint === null) {
    return recentJob.curriculumVersion === curriculumVersionOnDisk;
  }
  return (
    recentJob.grammarPointFingerprint === grammarPointFingerprint(cell.grammarPoint)
  );
}

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
 * @param targetSeeded             Whether this cell's generation is seeded
 *                                 from curated coverage targets (vocab
 *                                 umbrella cells with `vocab_target` rows).
 *                                 When `true`, step 7 (low-yield) is skipped
 *                                 — a coverage-converging cell's tail
 *                                 (<=2 uncovered targets) approves fewer
 *                                 than `LOW_YIELD_THRESHOLD` by construction,
 *                                 so the low-yield suppression would strand
 *                                 the last targets until a curriculum bump.
 *                                 Saturated-dedup (steps 5-6) still applies.
 * @returns An `EnqueueDecision` discriminated union the handler switches on.
 */
export function decideEnqueue(
  cell: Cell,
  approvedInPool: number,
  target: number,
  recentJob: RecentJob | null,
  curriculumVersionOnDisk: string | undefined,
  targetSeeded = false,
  options: DecideEnqueueOptions = {},
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
  //    Sub-case (b) is still decided on the version constant, because a
  //    missing constant is a metadata problem rather than a content one.
  if (curriculumVersionOnDisk === undefined) {
    return { kind: 'enqueue', need };
  }

  //    (a) is decided PER POINT, not per language (2026-08-26). The version
  //    constant covers a whole language while the suppression it clears covers
  //    one cell, so editing any single point re-released every cell in that
  //    language — and since curricula here are edited most days, neither
  //    `skip-low-yield` nor `skip-saturated-dedup` ever fired in production
  //    (both the 2026-08-25 and 2026-08-26 runs logged 0 of each while
  //    `de-a2-praeteritum-modals` burned ~$0.96/night producing 47 drafts for
  //    14 requested, 11 of them dedup collisions, on every run since 08-15).
  //
  //    Comparing the point's own content fingerprint keeps R6.4's promise
  //    exactly where it was aimed — a curriculum fix always reaches the cells
  //    it targets — while letting every other cell keep the give-up state it
  //    earned. It is also STRICTLY more sensitive than the version test in the
  //    other direction: an edit made deliberately without a version bump (the
  //    repo does this; see the 2026-08-18 note in es.ts) previously could not
  //    reach a suppressed cell at all, and now does.
  if (!curriculumUnchangedForCell(recentJob, cell, curriculumVersionOnDisk)) {
    return { kind: 'enqueue', need };
  }

  // 4b. Staleness lapse. Suppression is evidence-based, and evidence ages out:
  //     the run that justified it may predate a prompt, model or seed-pool fix
  //     that the point's fingerprint cannot see. Placed after the target-reached
  //     check (step 2) so it only ever re-opens a cell that is still SHORT —
  //     never a finished one — and before the suppression branches so it clears
  //     low-yield and saturated-dedup alike.
  const lapseDays = options.suppressionLapseDays ?? SUPPRESSION_LAPSE_DAYS;
  const ageMs = (options.now ?? new Date()).getTime() - recentJob.finishedAt.getTime();
  if (ageMs >= lapseDays * MS_PER_DAY) {
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
  //    Exempt target-seeded (coverage-converging) vocab cells: their tail
  //    (<=2 uncovered targets) approves <LOW_YIELD_THRESHOLD by construction,
  //    so low-yield would strand the last targets until a curriculum bump.
  //    By this point `need > 0` (step 2 already returned skip-target-reached
  //    otherwise), so the exemption only keeps a genuinely-uncovered cell live.
  //    Saturated-dedup (steps 5-6) still applies — a cell that truly can't
  //    generate new distinct words is still suppressed.
  //
  //    Measured against the REQUEST, not a bare constant: a cell topped up
  //    with 1-2 drafts can never approve 3, so a flat `approvedCount < 3`
  //    branded it stuck however well it did. On prod, of the 330 cells that
  //    test called low-yield, 231 had been asked for fewer than 3 drafts and
  //    187 of those approved EVERY draft they were given. That was harmless
  //    only because the per-language version test re-released everything
  //    nightly; the moment suppression actually applies (the per-point gate in
  //    step 4) it would strand ~187 healthy cells under target for good.
  //    `requestedCount === 0` yields a threshold of 0, so such a job — which
  //    tells us nothing about yield — never suppresses.
  const lowYieldThreshold = Math.min(
    LOW_YIELD_THRESHOLD,
    recentJob.requestedCount,
  );
  if (!targetSeeded && recentJob.approvedCount < lowYieldThreshold) {
    return { kind: 'skip-low-yield' };
  }

  // 8. Default: enqueue.
  return { kind: 'enqueue', need };
}
