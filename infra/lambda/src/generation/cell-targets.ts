/**
 * Per-cell generation target resolver (R3). Replaces the flat
 * `TARGET_PER_CELL = 50` the scheduler used to top up every cell with a target
 * derived from the cell's grammar point and `(exerciseType, cefrLevel)`, so
 * narrow A1/A2 cells stop grinding an unreachable 50 into dedup waste.
 *
 * Pure: no I/O, no env, no AWS SDK — same constraints as `scheduler-decision`.
 *
 * Resolution order:
 *   1. `cell.grammarPoint.targetOverride` — per-point precision knob for a
 *      narrow point whose realistic distinct-exercise supply is well below the
 *      level default; wins outright (R3.2).
 *   2. `CELL_TARGET_DEFAULTS[exerciseType][cefrLevel]` — the level-appropriate
 *      default, raised if needed to cover the largest single-axis floor sum in
 *      the cell's `coverageSpec` (floor-driven target: see `resolveCellTarget`).
 *      Cloze/translation taper at A1/A2 (limited lexical space at the lower
 *      levels) and leave B1/B2 unset; vocab_recall is capped LOW (10) at every
 *      level for token efficiency — a single "everyday" umbrella exhausts its
 *      realistic distinct-word surface long before the old 60–75, so chasing it
 *      burned tokens on dedup-give-ups. Breadth comes from more themed umbrellas
 *      (more cells), not a high per-cell target.
 *   3. `TARGET_PER_CELL` — global fallback for any `(type, level)` the table
 *      leaves unset (e.g. B1/B2 cloze/translation, where 50 stays reachable),
 *      also subject to the floor raise above.
 */

import { ExerciseType } from '@language-drill/shared';
import type { Cell, CurriculumCefrLevel } from '@language-drill/db';

import { TARGET_PER_CELL } from './scheduler-decision';

/**
 * Default per-cell targets keyed by `(exerciseType, cefrLevel)`. `Partial` on
 * the level axis: an unset level falls through to `TARGET_PER_CELL` in
 * `resolveCellTarget`. Design-tunable — the exact numbers are a design-phase
 * decision (R3.1); the invariants that matter are (a) narrow A1/A2
 * cloze/translation cells resolve below the global 50, and (b) vocab_recall is
 * capped low (10) at every level for token efficiency (a single umbrella
 * exhausts its distinct-word surface fast; breadth comes from more cells).
 */
export const CELL_TARGET_DEFAULTS: Record<
  ExerciseType,
  Partial<Record<CurriculumCefrLevel, number>>
> = {
  // A1/A2 have a smaller realistic distinct-exercise ceiling than the global
  // 50; B1/B2 are unset → they fall through to TARGET_PER_CELL.
  [ExerciseType.CLOZE]: { A1: 20, A2: 30 },
  [ExerciseType.TRANSLATION]: { A1: 20, A2: 30 },
  [ExerciseType.SENTENCE_CONSTRUCTION]: { A1: 20, A2: 30 },
  // A1/A2: narrow grammar-point verb-form space mirrors cloze/translation.
  // B1/B2: unset → fall through to TARGET_PER_CELL (50 remains reachable).
  [ExerciseType.CONJUGATION]: { A1: 20, A2: 30 },
  // Capped low across every level (2026-06-07): vocab cells are the worst
  // token-efficiency offenders — a single "everyday" umbrella exhausts its
  // realistic distinct-word surface fast (high dedup-give-up), so chasing the
  // old 60–75 burned tokens for near-zero net new approvals. 10 is enough to
  // give the today-plan's single vocab slot variety across sessions; breadth
  // now comes from splitting into more themed umbrellas, not a high per-cell
  // target.
  [ExerciseType.VOCAB_RECALL]: { A1: 10, A2: 10, B1: 10, B2: 10 },
  // B1/B2: 15. A1/A2: 6/10 — the distinct-clip surface is small at low levels
  // (short clips), so a high target just grinds the dedup index; the per-ordinal
  // domain rotation (dictation-generation-prompts.ts) makes these reachable.
  [ExerciseType.DICTATION]: { A1: 6, A2: 10, B1: 15, B2: 15 },
  // Free-writing prompts are batch-generated (Phase 2). Capped LOW (5) at every
  // level: a single (language, level, topic) cell has a tiny distinct-title space
  // — the dedup surface is the title — so even with the prior-title avoid-list and
  // angle rotation, narrow topics hit heavy dedup-give-up above ~5 (the 2026-06-16
  // run stalled at 3 on es-b1-fw-my-town / es-b2-fw-remote-work chasing 8). 5 is
  // reachable per topic; breadth comes from more curated topic umbrellas. A1/A2
  // are set for TR free-writing (2026-06-17).
  [ExerciseType.FREE_WRITING]: { A1: 5, A2: 5, B1: 5, B2: 5 },
};

/**
 * Phase 1 coverage controller — a person bucket is **given up** (excluded from
 * the deficit) when its most recent targeted batch asked for it at least this
 * many times and produced zero approved drafts realizing it. Two honest
 * attempts before suppression; person buckets are small, so a single-attempt
 * miss is too noisy. Cleared by a CURRICULUM_VERSION bump (same gate as the
 * cell-level low-yield / saturated-dedup suppression). Design-tunable.
 */
export const GIVE_UP_MIN_ATTEMPTS = 2;

/**
 * Resolve the generation target for a cell. Pure. Order: an explicit
 * `targetOverride` wins outright; otherwise the `(type, level)` table value (or
 * the `TARGET_PER_CELL` fallback) is raised, if needed, to cover the largest
 * single-axis floor sum in the cell's `coverageSpec`. One approved exercise
 * realizes one value per axis, so an axis whose floors sum to F needs ≥ F
 * exercises; taking the MAX over axes (never the product) guarantees headroom
 * for the tightest axis without multiplying axes together. Replaces the former
 * person-rotation 1.5× multiplier with exact floor arithmetic.
 */
export function resolveCellTarget(cell: Cell): number {
  const override = cell.grammarPoint.targetOverride;
  if (override !== undefined) return override;
  const fromTable = CELL_TARGET_DEFAULTS[cell.exerciseType][cell.cefrLevel];
  const base = fromTable ?? TARGET_PER_CELL;
  const spec = cell.grammarPoint.coverageSpec;
  if (!spec) return base;
  let maxAxisFloorSum = 0;
  for (const axis of spec.axes) {
    let sum = 0;
    for (const floor of Object.values(axis.floors)) sum += (floor as number) ?? 0;
    if (sum > maxAxisFloorSum) maxAxisFloorSum = sum;
  }
  return Math.max(base, maxAxisFloorSum);
}
