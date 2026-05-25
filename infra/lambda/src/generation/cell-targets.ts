/**
 * Per-cell generation target resolver (R3). Replaces the flat
 * `TARGET_PER_CELL = 50` the scheduler used to top up every cell with a target
 * derived from the cell's grammar point and `(exerciseType, cefrLevel)`, so
 * narrow A1/A2 cells stop grinding an unreachable 50 into dedup waste.
 *
 * Pure: no I/O, no env, no AWS SDK — same constraints as `scheduler-decision`.
 *
 * Resolution order (R3.1):
 *   1. `cell.grammarPoint.targetOverride` — per-point precision knob for a
 *      narrow point whose realistic distinct-exercise supply is well below the
 *      level default (R3.2).
 *   2. `CELL_TARGET_DEFAULTS[exerciseType][cefrLevel]` — the level-appropriate
 *      default. Cloze/translation taper at A1/A2 (limited lexical space at the
 *      lower levels) and leave B1/B2 unset; vocab_recall is set ABOVE the
 *      global default at every level because its surface space is
 *      `N × distinctWords` — each target word can carry up to N (≈3–4, the
 *      per-word cap from R6) distinct cues, so the cell holds many more rows
 *      than a one-per-word cloze cell (R6.6).
 *   3. `TARGET_PER_CELL` — global fallback for any `(type, level)` the table
 *      leaves unset (e.g. B1/B2 cloze/translation, where 50 stays reachable).
 */

import { ExerciseType } from '@language-drill/shared';
import type { Cell, CurriculumCefrLevel } from '@language-drill/db';

import { TARGET_PER_CELL } from './scheduler-decision';

/**
 * Default per-cell targets keyed by `(exerciseType, cefrLevel)`. `Partial` on
 * the level axis: an unset level falls through to `TARGET_PER_CELL` in
 * `resolveCellTarget`. Design-tunable — the exact numbers are a design-phase
 * decision (R3.1); the invariants that matter are (a) narrow A1/A2
 * cloze/translation cells resolve below the global 50, and (b) vocab_recall
 * resolves above it to reflect the `N × distinctWords` surface space (R6.6).
 */
export const CELL_TARGET_DEFAULTS: Record<
  ExerciseType,
  Partial<Record<CurriculumCefrLevel, number>>
> = {
  // A1/A2 have a smaller realistic distinct-exercise ceiling than the global
  // 50; B1/B2 are unset → they fall through to TARGET_PER_CELL.
  [ExerciseType.CLOZE]: { A1: 20, A2: 30 },
  [ExerciseType.TRANSLATION]: { A1: 20, A2: 30 },
  // N×distinctWords surface space (R6.6) → above the global default everywhere.
  [ExerciseType.VOCAB_RECALL]: { A1: 60, A2: 60, B1: 75, B2: 75 },
};

/**
 * Resolve the generation target for a cell. Pure; see the module doc for the
 * `override → table → fallback` order.
 */
export function resolveCellTarget(cell: Cell): number {
  const override = cell.grammarPoint.targetOverride;
  if (override !== undefined) return override;
  const fromTable = CELL_TARGET_DEFAULTS[cell.exerciseType][cell.cefrLevel];
  return fromTable ?? TARGET_PER_CELL;
}
