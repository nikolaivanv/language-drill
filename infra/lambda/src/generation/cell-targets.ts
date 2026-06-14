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
 *      lower levels) and leave B1/B2 unset; vocab_recall is capped LOW (10) at
 *      every level for token efficiency — a single "everyday" umbrella exhausts
 *      its realistic distinct-word surface long before the old 60–75, so
 *      chasing it burned tokens on dedup-give-ups. Breadth comes from more
 *      themed umbrellas (more cells), not a high per-cell target.
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
  // Capped low across every level (2026-06-07): vocab cells are the worst
  // token-efficiency offenders — a single "everyday" umbrella exhausts its
  // realistic distinct-word surface fast (high dedup-give-up), so chasing the
  // old 60–75 burned tokens for near-zero net new approvals. 10 is enough to
  // give the today-plan's single vocab slot variety across sessions; breadth
  // now comes from splitting into more themed umbrellas, not a high per-cell
  // target.
  [ExerciseType.VOCAB_RECALL]: { A1: 10, A2: 10, B1: 10, B2: 10 },
  // Dictation is NOT batch-generated (never enumerated as a generation cell),
  // so it has no per-cell targets; this empty record is never consulted.
  [ExerciseType.DICTATION]: {},
};

/**
 * Target raise for `personRotation` cells (2026-06-12). The person-rotation
 * fix only affects FUTURE drafts, but the skewed cells (audit: ≥90% 3sg in
 * every TR tense cell) were already at/near their targets and resolved to
 * `skip-target-reached` — so without a raise the rotation never materialises
 * in the pool. 1.5× gives each flagged cloze/translation cell headroom for
 * roughly one-to-two full person cycles of new drafts on top of the existing
 * (3sg-heavy) inventory.
 *
 * Scope guards:
 *   - cloze/translation ONLY — the audited 3sg skew lives in those pools, and
 *     `sentence_construction` already gained fresh headroom when its pilot
 *     brake lifted (2026-06-08: 25 → 30 at A2, 50 at B1/B2), so rotated SC
 *     drafts flow without a further raise; vocab umbrellas can't carry the
 *     flag (curriculum invariant).
 *   - an explicit `targetOverride` is respected as-is: overrides mark
 *     supply-limited points, and multiplying them would grind dedup waste —
 *     set the override with rotation in mind instead.
 */
export const PERSON_ROTATION_TARGET_MULTIPLIER = 1.5;

const PERSON_ROTATION_RAISED_TYPES: ReadonlySet<ExerciseType> = new Set([
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
]);

/**
 * Resolve the generation target for a cell. Pure; see the module doc for the
 * `override → table → fallback` order, plus the person-rotation raise above
 * (applied to the table/fallback value, never to an explicit override).
 */
export function resolveCellTarget(cell: Cell): number {
  const override = cell.grammarPoint.targetOverride;
  if (override !== undefined) return override;
  const fromTable = CELL_TARGET_DEFAULTS[cell.exerciseType][cell.cefrLevel];
  const base = fromTable ?? TARGET_PER_CELL;
  if (
    cell.grammarPoint.personRotation &&
    PERSON_ROTATION_RAISED_TYPES.has(cell.exerciseType)
  ) {
    return Math.ceil(base * PERSON_ROTATION_TARGET_MULTIPLIER);
  }
  return base;
}
