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
});

// ---------------------------------------------------------------------------
// Decision cases — keyed to tasks.md task 19 numbered list
// ---------------------------------------------------------------------------

describe('decideEnqueue — table-driven cases', () => {
  it('case 1: C2 cell → skip-c2 (Round-1 narrowing per Req 4.5)', () => {
    const decision = decideEnqueue(C2_CELL, 0, null, CURRENT_VERSION);
    expect(decision).toEqual({ kind: 'skip-c2' });
  });

  it('case 2: approvedInPool ≥ TARGET → skip-target-reached (R1.3)', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL,
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
      makeRecentJob(),
      CURRENT_VERSION,
    );
    expect(overshoot).toEqual({ kind: 'skip-target-reached' });
  });

  it('case 3: no recentJob, under target → enqueue with need = TARGET - approved', () => {
    const decision = decideEnqueue(ROUND_1_CELL, 12, null, CURRENT_VERSION);
    expect(decision).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL - 12 });
  });

  it('case 4: low-yield + curriculum match → skip-low-yield (R1.4)', () => {
    // Most recent job produced fewer than LOW_YIELD_THRESHOLD net new
    // approveds. Curriculum hasn't changed, so suppression stands.
    const decision = decideEnqueue(
      ROUND_1_CELL,
      20,
      makeRecentJob({ approvedCount: 2, requestedCount: 50 }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'skip-low-yield' });
  });

  it('case 5: low-yield + curriculum mismatch → enqueue (R6.4 clears suppression)', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL,
      20,
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
    const decision = decideEnqueue(ROUND_1_CELL, 0, null, CURRENT_VERSION);
    expect(decision).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL });
  });

  it('C2 takes precedence over target-reached (case 1 wins over case 2 even when both would fire)', () => {
    // A C2 cell that somehow has approvedInPool ≥ TARGET must still return
    // skip-c2 (not skip-target-reached) — the Round-1 filter is the
    // outermost gate.
    const decision = decideEnqueue(
      C2_CELL,
      TARGET_PER_CELL + 10,
      makeRecentJob(),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'skip-c2' });
  });
});
