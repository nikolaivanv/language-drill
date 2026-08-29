/**
 * Table-driven unit tests for `decideEnqueue`. No DB, no env vars, no AWS
 * SDK — the pure-module split means every behavior is exercised through
 * pure inputs and observed through the discriminated-union output.
 *
 * Each case names a single requirement bullet and pins it. The table format
 * matches the case list in `tasks.md` task 19 so the cases are easy to
 * cross-reference during review.
 */

import { CefrLevel, ExerciseType, Language, grammarPointFingerprint } from '@language-drill/shared';
import { describe, expect, it } from 'vitest';

import type { Cell } from '@language-drill/db';

import {
  decideEnqueue,
  LOW_YIELD_THRESHOLD,
  TARGET_SEEDED_ZERO_RUNS_BEFORE_LOW_YIELD,
  PREDICTIVE_SATURATION_MARGIN_FRACTION,
  SATURATED_DEDUP_APPROVED_FRACTION,
  SATURATED_DEDUP_REQ_FRACTION,
  SUPPRESSION_LAPSE_DAYS,
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
    // Matches ROUND_1_CELL's point by default, i.e. "the point has not changed
    // since that job ran" — the case where suppression must survive.
    grammarPointFingerprint: grammarPointFingerprint(grammarPoint),
    coverageOutcome: null,
    // RELATIVE, not a fixed date: since the 2026-08-26 staleness lapse, a
    // fixture pinned to an absolute day silently ages past the lapse window and
    // every suppression case starts returning `enqueue` instead. These cases
    // all mean "a job that ran recently"; the lapse itself is tested with an
    // injected clock below.
    finishedAt: new Date(Date.now() - 86_400_000),
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
        // A real curriculum edit moves BOTH: the point's content changes and
        // the language constant is bumped in the same commit. Since 2026-08-26
        // it is the POINT that clears suppression — see the per-point gate
        // describe below for the language-bump-alone case.
        curriculumVersion: STALE_VERSION,
        grammarPointFingerprint: grammarPointFingerprint({
          ...grammarPoint,
          description: 'edited by the curriculum change under test',
        } as never),
      }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL - 20 });
  });

  it('skips low-yield for a non-target-seeded cell (unchanged)', () => {
    // targetSeeded defaults to false → existing behavior preserved.
    const decision = decideEnqueue(
      ROUND_1_CELL,
      20,
      TARGET_PER_CELL,
      makeRecentJob({ approvedCount: 1, requestedCount: 5 }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'skip-low-yield' });
  });

  it('does NOT skip low-yield for a target-seeded vocab cell with uncovered targets', () => {
    // approvedInPool 28 < target 30 → need 2; low-yield would fire, but
    // targetSeeded exempts it so the coverage tail keeps converging.
    const decision = decideEnqueue(
      ROUND_1_CELL,
      28,
      30,
      makeRecentJob({ approvedCount: 1, requestedCount: 5 }),
      CURRENT_VERSION,
      true,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: 2 });
  });

  it('DOES skip low-yield for a target-seeded cell stuck at zero for three runs', () => {
    // The exemption's rationale is that a converging tail approves fewer than
    // LOW_YIELD_THRESHOLD *by construction* — approving 1 of 1 is converging.
    // A cell that approves NOTHING run after run is stuck, not converging, and
    // an unconditional exemption could not tell the two apart: it re-requested
    // the same unproduceable target nightly forever, since saturated-dedup
    // only catches the dedup flavour of stuck (usually it is not dedup).
    const decision = decideEnqueue(
      ROUND_1_CELL,
      28,
      30,
      makeRecentJob({
        approvedCount: 0,
        requestedCount: 1,
        consecutiveZeroApprovedRuns: TARGET_SEEDED_ZERO_RUNS_BEFORE_LOW_YIELD,
      }),
      CURRENT_VERSION,
      true,
    );
    expect(decision).toEqual({ kind: 'skip-low-yield' });
  });

  it('does NOT skip a target-seeded cell on a single unlucky zero run', () => {
    // Measured on prod 2026-08-29: tr-b2-vocab-work-professional ran
    // 3/6 4/6 3/6 4/6 3/6 0/6 — productive every night but the last. These
    // cells are small (1-8 drafts), so one zero night is noise, and
    // suppressing on it would strand a healthy cell for the whole 30-day
    // lapse. Evidence has to accumulate, exactly as it does for construction
    // variants.
    const decision = decideEnqueue(
      ROUND_1_CELL,
      28,
      30,
      makeRecentJob({
        approvedCount: 0,
        requestedCount: 6,
        consecutiveZeroApprovedRuns: 1,
      }),
      CURRENT_VERSION,
      true,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: 2 });
  });

  it('does NOT skip a target-seeded cell whose last job requested nothing', () => {
    // requestedCount 0 tells us nothing about yield, so it must not suppress
    // however long the zero streak is — the threshold is 0 there, which is
    // why this needs no separate branch.
    const decision = decideEnqueue(
      ROUND_1_CELL,
      28,
      30,
      makeRecentJob({
        approvedCount: 0,
        requestedCount: 0,
        consecutiveZeroApprovedRuns: 10,
      }),
      CURRENT_VERSION,
      true,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: 2 });
  });

  it('still suppresses a target-seeded cell on saturated-dedup (backstop intact)', () => {
    // dedupGivenUp high + approved low → saturated-dedup fires regardless of
    // targetSeeded (steps 5-6 remain a genuine backstop).
    const decision = decideEnqueue(
      ROUND_1_CELL,
      20,
      30,
      makeRecentJob({ approvedCount: 0, requestedCount: 10, dedupGivenUpCount: 6 }),
      CURRENT_VERSION,
      true,
    );
    expect(decision).toEqual({ kind: 'skip-saturated-dedup' });
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
        // A real curriculum edit moves BOTH: the point's content changes and
        // the language constant is bumped in the same commit. Since 2026-08-26
        // it is the POINT that clears suppression — see the per-point gate
        // describe below for the language-bump-alone case.
        curriculumVersion: STALE_VERSION,
        grammarPointFingerprint: grammarPointFingerprint({
          ...grammarPoint,
          description: 'edited by the curriculum change under test',
        } as never),
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
    // Legacy row written before the columns existed — NULL should be treated
    // as "older than any known version" so the cell becomes schedulable. Both
    // columns are NULL on such a row: they are written together when a job
    // opens, so a fingerprint can never be present where the version is not.
    const decision = decideEnqueue(
      ROUND_1_CELL,
      15,
      TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 2,
        requestedCount: 50,
        curriculumVersion: null,
        grammarPointFingerprint: null,
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
    // `enqueue` is what proves the guard held: neither suppression fired.
    // (Before 2026-08-26 this landed on `skip-low-yield`, because the low-yield
    // test ignored requestedCount; now a 0-draft request yields a threshold of
    // 0 and cannot suppress either. Both outcomes prove the same thing about
    // saturated-dedup, which is what this case exists to pin.)
    expect(decision).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL });
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
        // A real curriculum edit moves BOTH: the point's content changes and
        // the language constant is bumped in the same commit. Since 2026-08-26
        // it is the POINT that clears suppression — see the per-point gate
        // describe below for the language-bump-alone case.
        curriculumVersion: STALE_VERSION,
        grammarPointFingerprint: grammarPointFingerprint({
          ...grammarPoint,
          description: 'edited by the curriculum change under test',
        } as never),
      }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: 5 });
  });
});

// ---------------------------------------------------------------------------
// Per-point suppression gate (2026-08-26). The version test was per-LANGUAGE
// while the suppression it clears is per-CELL, so one edit anywhere in a
// language re-released every cell in it — and since this repo edits curricula
// most days, `skip-low-yield` and `skip-saturated-dedup` never actually fired
// in prod. See grammar-point-fingerprint.ts for the measured evidence.
// ---------------------------------------------------------------------------

describe('decideEnqueue — per-point suppression gate', () => {
  // THE FIX. Yesterday this returned `enqueue` and the cell ran again.
  it('keeps low-yield suppression when the language version moved but this point did not', () => {
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
    expect(decision).toEqual({ kind: 'skip-low-yield' });
  });

  // The prod case: de:a2:conjugation:de-a2-praeteritum-modals, which met the
  // saturated-dedup thresholds on every run since 2026-08-15 and was
  // re-enqueued nightly anyway because DE's version kept moving.
  it('keeps saturated-dedup suppression when only the language version moved', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL,
      20,
      TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 1,
        requestedCount: 14,
        dedupGivenUpCount: 11,
        curriculumVersion: STALE_VERSION,
      }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'skip-saturated-dedup' });
  });

  // A real edit to THIS point still forces the fresh attempt R6.4 promises.
  it('clears suppression when the point itself changed', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL,
      20,
      TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 2,
        requestedCount: 50,
        grammarPointFingerprint: grammarPointFingerprint({
          ...grammarPoint,
          description: 'rewritten',
        } as never),
      }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL - 20 });
  });

  // Strictly better than the version test: this repo deliberately makes some
  // curriculum edits WITHOUT a version bump (see the 2026-08-18 note in es.ts).
  // Those edits previously could not reach a suppressed cell at all.
  it('clears suppression for a point edit that did NOT bump the language version', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL,
      20,
      TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 2,
        requestedCount: 50,
        curriculumVersion: CURRENT_VERSION,
        grammarPointFingerprint: grammarPointFingerprint({
          ...grammarPoint,
          name: 'Renamed point',
        } as never),
      }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL - 20 });
  });

  // Legacy rows written before the column existed fall back to the old test,
  // so they are released exactly once and then carry a fingerprint forever.
  it('falls back to the version test for a legacy row with no fingerprint', () => {
    const stale = decideEnqueue(
      ROUND_1_CELL, 20, TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 2, requestedCount: 50,
        curriculumVersion: STALE_VERSION, grammarPointFingerprint: null,
      }),
      CURRENT_VERSION,
    );
    expect(stale).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL - 20 });

    const current = decideEnqueue(
      ROUND_1_CELL, 20, TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 2, requestedCount: 50,
        curriculumVersion: CURRENT_VERSION, grammarPointFingerprint: null,
      }),
      CURRENT_VERSION,
    );
    expect(current).toEqual({ kind: 'skip-low-yield' });
  });

  // Unchanged safe default: never permanently disable a cell on missing metadata.
  it('still enqueues when the on-disk version constant is missing', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL, 20, TARGET_PER_CELL,
      makeRecentJob({ approvedCount: 2, requestedCount: 50 }),
      undefined,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL - 20 });
  });
});

// ---------------------------------------------------------------------------
// Low-yield vs. a small request (2026-08-26). `approvedCount < 3` took no
// account of how many drafts were ASKED for, so a cell topped up with 1-2
// drafts was branded stuck no matter how well it did. Latent while the
// per-language version test re-released everything nightly; load-bearing the
// moment suppression actually applies. Measured on prod: of 330 cells the old
// rule called low-yield, 231 were asked for fewer than 3 drafts and 187 of
// those approved EVERY draft they were given.
// ---------------------------------------------------------------------------

describe('decideEnqueue — low-yield accounts for the request size', () => {
  it.each([
    [1, 1],
    [2, 2],
  ])('does not call a cell low-yield when it approved all %i of %i requested', (approved, requested) => {
    const decision = decideEnqueue(
      ROUND_1_CELL, 45, TARGET_PER_CELL,
      makeRecentJob({ approvedCount: approved, requestedCount: requested }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: 5 });
  });

  it('still calls a cell low-yield when it approved none of a small request', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL, 45, TARGET_PER_CELL,
      makeRecentJob({ approvedCount: 0, requestedCount: 1 }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'skip-low-yield' });
  });

  it('still calls a cell low-yield when it approved 2 of a full request', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL, 20, TARGET_PER_CELL,
      makeRecentJob({ approvedCount: 2, requestedCount: 50 }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'skip-low-yield' });
  });

  it('never calls a cell low-yield on a zero-request job (tells us nothing)', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL, 45, TARGET_PER_CELL,
      makeRecentJob({ approvedCount: 0, requestedCount: 0 }),
      CURRENT_VERSION,
    );
    expect(decision).toEqual({ kind: 'enqueue', need: 5 });
  });
});

// ---------------------------------------------------------------------------
// Staleness lapse (2026-08-26). Since #703 suppression clears only on a
// CURRICULUM edit, so a cell suppressed over a defect that was later fixed
// somewhere the fingerprint cannot see — a generation/validation prompt, the
// model, the seed pool — would stay suppressed until someone happened to edit
// its point. The lapse is the safety valve: give-up expires on its own.
// ---------------------------------------------------------------------------

describe('decideEnqueue — suppression lapses with age', () => {
  const JOB_FINISHED = new Date('2026-06-01T04:00:00Z');
  const stuck = () =>
    makeRecentJob({ approvedCount: 0, requestedCount: 50, finishedAt: JOB_FINISHED });

  it('keeps suppression while the evidence is fresh', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL, 20, TARGET_PER_CELL, stuck(), CURRENT_VERSION, false,
      { now: new Date('2026-06-20T04:00:00Z'), suppressionLapseDays: 30 },
    );
    expect(decision).toEqual({ kind: 'skip-low-yield' });
  });

  it('clears suppression once the evidence is older than the lapse', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL, 20, TARGET_PER_CELL, stuck(), CURRENT_VERSION, false,
      { now: new Date('2026-07-05T04:00:00Z'), suppressionLapseDays: 30 },
    );
    expect(decision).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL - 20 });
  });

  it('lapses saturated-dedup suppression too, not just low-yield', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL, 20, TARGET_PER_CELL,
      makeRecentJob({
        approvedCount: 1, requestedCount: 14, dedupGivenUpCount: 11,
        finishedAt: JOB_FINISHED,
      }),
      CURRENT_VERSION, false,
      { now: new Date('2026-07-05T04:00:00Z'), suppressionLapseDays: 30 },
    );
    expect(decision).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL - 20 });
  });

  it('is exactly at the boundary inclusive: exactly N days old lapses', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL, 20, TARGET_PER_CELL, stuck(), CURRENT_VERSION, false,
      { now: new Date('2026-07-01T04:00:00Z'), suppressionLapseDays: 30 },
    );
    expect(decision).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL - 20 });
  });

  // A cell already at target must stay skipped regardless of age — the lapse
  // exists to retry STUCK cells, not to re-open finished ones.
  it('never re-opens a cell that reached its target', () => {
    const decision = decideEnqueue(
      ROUND_1_CELL, TARGET_PER_CELL, TARGET_PER_CELL, stuck(), CURRENT_VERSION, false,
      { now: new Date('2027-01-01T04:00:00Z'), suppressionLapseDays: 30 },
    );
    expect(decision).toEqual({ kind: 'skip-target-reached' });
  });

  it('defaults to the exported lapse constant when none is supplied', () => {
    const justInside = new Date(
      JOB_FINISHED.getTime() + (SUPPRESSION_LAPSE_DAYS - 1) * 86_400_000,
    );
    expect(
      decideEnqueue(ROUND_1_CELL, 20, TARGET_PER_CELL, stuck(), CURRENT_VERSION, false, {
        now: justInside,
      }),
    ).toEqual({ kind: 'skip-low-yield' });

    const justOutside = new Date(
      JOB_FINISHED.getTime() + (SUPPRESSION_LAPSE_DAYS + 1) * 86_400_000,
    );
    expect(
      decideEnqueue(ROUND_1_CELL, 20, TARGET_PER_CELL, stuck(), CURRENT_VERSION, false, {
        now: justOutside,
      }),
    ).toEqual({ kind: 'enqueue', need: TARGET_PER_CELL - 20 });
  });
});
