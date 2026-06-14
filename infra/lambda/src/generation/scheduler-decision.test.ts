/**
 * Table-driven unit tests for `decideEnqueue`. No DB, no env vars, no AWS
 * SDK — the pure-module split means every behavior is exercised through
 * pure inputs and observed through the discriminated-union output.
 *
 * Each case names a single requirement bullet and pins it. The table format
 * matches the case list in `tasks.md` task 19 so the cases are easy to
 * cross-reference during review.
 */

import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import { describe, expect, it } from 'vitest';

import type { Cell } from '@language-drill/db';

import {
  decideEnqueue,
  LOW_YIELD_THRESHOLD,
  PREDICTIVE_SATURATION_MARGIN_FRACTION,
  SATURATED_DEDUP_APPROVED_FRACTION,
  SATURATED_DEDUP_REQ_FRACTION,
  TARGET_PER_CELL,
  type RecentJob,
} from './scheduler-decision';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const grammarPoint = {
  key: 'es-b1-test',
  language: Language.ES,
  cefrLevel: CefrLevel.B1,
  title: 'test',
  summary: 'test',
} as unknown as Cell['grammarPoint'];

/** Round-1 cell (B1) — used for every case except the C2 one. */
const ROUND_1_CELL: Cell = {
  language: Language.ES,
  cefrLevel: CefrLevel.B1,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint,
  cellKey: 'es:b1:cloze:es-b1-test',
};

/**
 * C2 cell — used by case 1 to assert the Round-1 narrowing.
 *
 * `Cell.cefrLevel` is statically narrowed to `CurriculumCefrLevel` (the curriculum-
 * facing type that excludes C1/C2 by construction), so building a C2 Cell
 * requires a cast. Production code that touches Cell never sees C2 because
 * `enumerateCurriculumCells` filters the curriculum source before
 * constructing Cells. The test injects a C2 directly so the
 * `ROUND_1_CEFR_LEVELS` guard inside `decideEnqueue` can be exercised at
 * runtime — the guard is defense-in-depth on top of the static narrowing.
 */
const C2_CELL = {
  language: Language.ES,
  cefrLevel: CefrLevel.C2,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint,
  cellKey: 'es:c2:cloze:es-c2-test',
} as unknown as Cell;

const CURRENT_VERSION = '2026-05-23';
const STALE_VERSION = '2026-05-01';

function makeRecentJob(overrides: Partial<RecentJob> = {}): RecentJob {
  return {
    approvedCount: 50,
    requestedCount: 50,
    dedupGivenUpCount: 0,
    curriculumVersion: CURRENT_VERSION,
    coverageOutcome: null,
    finishedAt: new Date('2026-05-22T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Sanity — pin the constants so the tests read straight off the table
// ---------------------------------------------------------------------------

describe('decideEnqueue — constant values', () => {
  it('TARGET_PER_CELL = 50', () => {
    expect(TARGET_PER_CELL).toBe(50);
  });

  it('LOW_YIELD_THRESHOLD = 3', () => {
    expect(LOW_YIELD_THRESHOLD).toBe(3);
  });

  it('SATURATED_DEDUP_REQ_FRACTION = 0.5', () => {
    expect(SATURATED_DEDUP_REQ_FRACTION).toBe(0.5);
  });

  it('SATURATED_DEDUP_APPROVED_FRACTION = 0.3', () => {
    expect(SATURATED_DEDUP_APPROVED_FRACTION).toBe(0.3);
  });

  it('PREDICTIVE_SATURATION_MARGIN_FRACTION = 0.2', () => {
    expect(PREDICTIVE_SATURATION_MARGIN_FRACTION).toBe(0.2);
  });
});

// ---------------------------------------------------------------------------
// Decision cases — keyed to tasks.md task 19 numbered list
// ---------------------------------------------------------------------------

describe('decideEnqueue — table-driven cases', () => {
  it('case 1: C2 cell → skip-c2 (Round-1 narrowing per Req 4.5)', () => {
    const decision = decideEnqueue(C2_CELL, 0, TARGET_PER_CELL, null, CURRENT_VERSION);
    expect(decision).toEqual({ kind: 'skip-c2' });
  });

  it('case 2: approvedInPool ≥ TARGET → skip-target-reached (R1.3)', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL,
      TARGET_PER_CELL,
      TARGET_PER_CELL,
      makeRecentJob(),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'skip-target-reached' });

    // Also fires when approvedInPool exceeds TARGET (e.g. concurrent prior
    // batch over-shot during a manual top-up).
    const overshoot = decideEnqueue(
      ROUND_1_CELL,
      TARGET_PER_CELL + 5,
      TARGET_PER_CELL,
      makeRecentJob(),
      CURRENT_VERSION,
    );
    expect(overshoot).toEqual({ kind: 'skip-target-reached' });
  });

  it('case 3: no recentJob, under target → enqueue with need = TARGET - approved', () => {
    const decision = decideEnqueue(ROUND_1_CELL, 12, TARGET_PER_CELL, null, CURRENT_VERSION);
    expect(decision).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL - 12 });
  });

  it('case 4: low-yield + curriculum match → skip-low-yield (R1.4)', () => {
    // Most recent job produced fewer than LOW_YIELD_THRESHOLD net new
    // approveds. Curriculum hasn't changed, so suppression stands.
    const decision = decideEnqueue(
      ROUND_1_CELL,
      20,
      TARGET_PER_CELL,
      makeRecentJob({ approvedCount: 2, requestedCount: 50 }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'skip-low-yield' });
  });

  it('case 5: low-yield + curriculum mismatch → enqueue (R6.4 clears suppression)', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL,
      20,
      TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 2,
        requestedCount: 50,
        curriculumVersion: STALE_VERSION,
      }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL - 20 });
  });

  it('case 6: saturated-dedup + curriculum match → skip-saturated-dedup (R6.2)', () => {
    // requestedCount=20 → ceil(0.5 * 20) = 10, ceil(0.3 * 20) = 6.
    // dedupGivenUp=12 ≥ 10 AND approvedCount=5 < 6 → saturated.
    // approvedCount=5 ≥ LOW_YIELD_THRESHOLD=3 → NOT low-yield, so this case
    // exercises saturated-dedup independently (case 8 covers the BOTH-fire
    // precedence scenario).
    const decision = decideEnqueue(
      ROUND_1_CELL,
      15,
      TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 5,
        requestedCount: 20,
        dedupGivenUpCount: 12,
      }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'skip-saturated-dedup' });
  });

  it('case 7: saturated-dedup + curriculum mismatch → enqueue (R6.4 clears suppression)', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL,
      15,
      TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 2,
        requestedCount: 10,
        dedupGivenUpCount: 6,
        curriculumVersion: STALE_VERSION,
      }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL - 15 });
  });

  it('case 8: BOTH low-yield AND saturated-dedup with curriculum match → skip-saturated-dedup (R6.3 precedence)', () => {
    // requestedCount=10, approvedCount=2 satisfies:
    //   - low-yield: 2 < LOW_YIELD_THRESHOLD=3
    //   - saturated-dedup: dedupGivenUp=5 ≥ ceil(0.5*10)=5 AND 2 < ceil(0.3*10)=3
    // Saturated-dedup wins per R6.3.
    const decision = decideEnqueue(
      ROUND_1_CELL,
      15,
      TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 2,
        requestedCount: 10,
        dedupGivenUpCount: 5,
      }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'skip-saturated-dedup' });
  });

  it('case 9: recentJob.curriculumVersion === null → suppression cleared (treat as mismatch)', () => {
    // Legacy row written before the column existed — NULL should be treated
    // as "older than any known version" so the cell becomes schedulable.
    const decision = decideEnqueue(
      ROUND_1_CELL,
      15,
      TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 2,
        requestedCount: 50,
        curriculumVersion: null,
      }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL - 15 });
  });

  it('case 10: curriculumVersionOnDisk === undefined (missing constant) → enqueue (safe default)', () => {
    // The constant might be missing if a new language is added but the
    // CURRICULUM_VERSION_<LANG> export was forgotten. Safe-by-default: never
    // permanently disable a cell on missing metadata.
    const decision = decideEnqueue(
      ROUND_1_CELL,
      15,
      TARGET_PER_CELL,
      makeRecentJob({ approvedCount: 2, requestedCount: 50 }),
      undefined,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL - 15 });
  });

  it('case 11: edge: approvedInPool exactly 49 with no recent job → enqueue with need=1', () => {
    // The one-row-from-target case. Pins that TARGET_PER_CELL is an
    // INCLUSIVE upper bound on `approvedInPool < TARGET` (49 → enqueue;
    // 50 → skip).
    const decision = decideEnqueue(
      ROUND_1_CELL,
      TARGET_PER_CELL - 1,
      TARGET_PER_CELL,
      null,
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: 1 });
  });

  it('case 12: edge: requestedCount=0 boundary — does NOT fire saturated-dedup', () => {
    // A job with requestedCount=0 (e.g. a defensive no-op enqueue) would
    // satisfy `dedupGivenUp >= ceil(0)` AND `approved < ceil(0)` trivially
    // if the `requestedCount > 0` guard were missing. Pin the guard so the
    // saturated-dedup branch can't fire on degenerate data.
    const decision = decideEnqueue(
      ROUND_1_CELL,
      0,
      TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 0,
        requestedCount: 0,
        dedupGivenUpCount: 0,
      }),
      CURRENT_VERSION,
    );
    // approvedCount=0 < LOW_YIELD_THRESHOLD=3 → low-yield fires (since
    // saturated-dedup is guarded out and curriculum matches).
    expect(decision).toEqual({ kind: 'skip-low-yield' });
  });

  it('case 12 (variant): approvedInPool=0 with no recent job → enqueue full TARGET', () => {
    // The "totally empty cell" first-run case. Confirms `need = TARGET`
    // when the pool is at zero.
    const decision = decideEnqueue(ROUND_1_CELL, 0, TARGET_PER_CELL, null, CURRENT_VERSION);
    expect(decision).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL });
  });

  it('C2 takes precedence over target-reached (case 1 wins over case 2 even when both would fire)', () => {
    // A C2 cell that somehow has approvedInPool ≥ TARGET must still return
    // skip-c2 (not skip-target-reached) — the Round-1 filter is the
    // outermost gate.
    const decision = decideEnqueue(
      C2_CELL,
      TARGET_PER_CELL + 10,
      TARGET_PER_CELL,
      makeRecentJob(),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'skip-c2' });
  });

  it('R3: target-reached and need are computed against the resolved per-cell target, not the global 50', () => {
    // A narrow A1/A2 cell resolves to a target well below TARGET_PER_CELL.
    // With target=20, a pool of 20 is "reached" even though 20 < 50…
    expect(
      decideEnqueue(ROUND_1_CELL, 20, 20, null, CURRENT_VERSION),
    ).toEqual({ kind: 'skip-target-reached' });
    // …and `need` is measured against the resolved target (20 - 18 = 2),
    // not 50 - 18.
    expect(
      decideEnqueue(ROUND_1_CELL, 18, 20, null, CURRENT_VERSION),
    ).toEqual({ kind: 'enqueue', need: 2 });
  });
});

// ---------------------------------------------------------------------------
// Predictive saturation (R4.1 / R4.4 / R4.5)
//
// target = TARGET_PER_CELL = 50 → predictiveMargin = ceil(0.2 * 50) = 10.
// dedup-ratio threshold at requestedCount=50 → ceil(0.5 * 50) = 25.
// ---------------------------------------------------------------------------

describe('decideEnqueue — predictive saturation', () => {
  it('R4.1: near-ceiling + dedup-heavy last run → skip on the same tick, even when that run was productive', () => {
    // approvedInPool=45 → need=5 ≤ margin=10 (near ceiling).
    // dedupGivenUp=25 ≥ 25 → dedup-heavy. approvedCount=20 ≥ ceil(0.3*50)=15,
    // so the REACTIVE saturated-dedup branch does NOT fire — the suppression
    // here can only be the predictive branch (no fully-wasteful run required).
    const decision = decideEnqueue(
      ROUND_1_CELL,
      45,
      TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 20,
        requestedCount: 50,
        dedupGivenUpCount: 25,
      }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'skip-saturated-dedup' });
  });

  it('does NOT fire when the pool is not near the ceiling (need beyond the margin)', () => {
    // approvedInPool=20 → need=30 > margin=10. Same dedup-heavy-but-productive
    // job, so neither predictive nor reactive saturated-dedup fires → enqueue.
    const decision = decideEnqueue(
      ROUND_1_CELL,
      20,
      TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 20,
        requestedCount: 50,
        dedupGivenUpCount: 25,
      }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: 30 });
  });

  it('does NOT fire when the most-recent run was not dedup-heavy', () => {
    // Near ceiling (need=5) but dedupGivenUp=5 < 25 → predictive condition
    // unmet → enqueue the small remaining need.
    const decision = decideEnqueue(
      ROUND_1_CELL,
      45,
      TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 20,
        requestedCount: 50,
        dedupGivenUpCount: 5,
      }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: 5 });
  });

  it('R4.4: curriculum-version mismatch clears predictive suppression', () => {
    // Same near-ceiling + dedup-heavy setup as the R4.1 case, but the recorded
    // curriculumVersion is stale → the version-mismatch branch (step 4) clears
    // suppression before the predictive branch is reached → enqueue.
    const decision = decideEnqueue(
      ROUND_1_CELL,
      45,
      TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 20,
        requestedCount: 50,
        dedupGivenUpCount: 25,
        curriculumVersion: STALE_VERSION,
      }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: 5 });
  });
});
