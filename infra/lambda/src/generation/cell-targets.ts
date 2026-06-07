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
 * TEMPORARY pilot brake on `sentence_construction` (added 2026-06-07).
 *
 * The first production SC run auto-approved 222 drafts across 8 cells but the
 * prompt had three systematic faults (open `grammar_target` prompts → `ambiguous`
 * flags; model answers propagating `commonErrors`; spoiled instructions). The
 * generation-prompt fix shipping alongside this constant should fix them, but it
 * is UNCONFIRMED. Capping every SC level at this value keeps the nightly cron
 * from chasing 30–50 approvals/cell with an unproven prompt and burning tokens:
 *   - cells already at/above 25 approved (the ES B1/B2 cells, ~38–40) resolve to
 *     `skip-target-reached` → zero spend;
 *   - the under-filled TR A2 cells (16–22, and reported-speech at 5) still top up
 *     by a small `need`, each bounded by the scheduler's $0.50/cell cost cap — so
 *     we get a real, cheap production sample of the fix to inspect.
 *
 * Validate the fix with `pnpm eval:gen` (offline, cost-capped) BEFORE restoring
 * full targets. To restore: delete this constant and revert the
 * SENTENCE_CONSTRUCTION row below to `{ A1: 20, A2: 30 }` (B1/B2 fall back to
 * TARGET_PER_CELL = 50).
 */
export const SENTENCE_CONSTRUCTION_PILOT_TARGET = 25;

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
  // TEMPORARY pilot brake (2026-06-07): every active SC level capped at the
  // pilot target pending eval:gen confirmation of the prompt fix. B1/B2 are set
  // explicitly here (lower than the global 50 fallback) so the brake covers the
  // ES B1/B2 cells too. See SENTENCE_CONSTRUCTION_PILOT_TARGET above to restore.
  [ExerciseType.SENTENCE_CONSTRUCTION]: {
    A1: 20,
    A2: SENTENCE_CONSTRUCTION_PILOT_TARGET,
    B1: SENTENCE_CONSTRUCTION_PILOT_TARGET,
    B2: SENTENCE_CONSTRUCTION_PILOT_TARGET,
  },
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
