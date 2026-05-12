/**
 * Enumeration of every grammar-point theory cell in the curriculum.
 *
 * Theory has no per-type fan-out (Req 5.1): unlike the exercise pipeline,
 * which mints one cell per `(grammar_point, exercise_type)` pair, theory
 * produces a single page per grammar point. The `TheoryCell` shape mirrors
 * the exercise-side `Cell` (see `../generation/cells.ts:39`) minus
 * `exerciseType`.
 *
 * Vocab umbrellas are silently filtered out per resolved decision #6
 * (Req 5.2). They have no grammar-rule explanation to write up, so the
 * theory generator never sees them — no warning, no log.
 *
 * `THEORY_ROUND_1_CEFR_LEVELS` re-exports the exercise pipeline's
 * `ROUND_1_CEFR_LEVELS` (Req 5.4) so both generators share a single source
 * of truth for the phased-rollout level scope. Phase 6 widens it in one
 * place and lifts the scope for both pipelines simultaneously.
 */

import type { LearningLanguage } from '@language-drill/shared';

import type { CurriculumCefrLevel, GrammarPoint } from '../curriculum';
import { ROUND_1_CEFR_LEVELS } from '../generation/cells';
import { buildTheoryCellKey } from '../lib/theory-cell-key';

// ---------------------------------------------------------------------------
// Round-1 scope (shared with exercise generator)
// ---------------------------------------------------------------------------

/**
 * The CEFR levels Phase 2 theory generation targets. Re-exported verbatim
 * from `../generation/cells` so the exercise and theory pipelines never
 * drift on which levels are "in scope" for the round-1 rollout (Req 5.4).
 */
export const THEORY_ROUND_1_CEFR_LEVELS = ROUND_1_CEFR_LEVELS;

// ---------------------------------------------------------------------------
// TheoryCell type
// ---------------------------------------------------------------------------

/**
 * One theory cell: a single grammar point at a single CEFR level for a
 * single language. No `exerciseType` — theory pages are one-per-cell
 * (Req 5.1).
 */
export type TheoryCell = {
  language: LearningLanguage;
  cefrLevel: CurriculumCefrLevel;
  grammarPoint: GrammarPoint;
  cellKey: string;
};

// ---------------------------------------------------------------------------
// enumerateTheoryCells
// ---------------------------------------------------------------------------

/**
 * Enumerate every grammar-point theory cell the curriculum supports. Vocab
 * umbrellas are skipped silently (Req 5.2); the output order matches the
 * input curriculum order so callers can rely on it for deterministic
 * scheduling.
 *
 * Pure — no DB, no I/O. Output is freshly allocated on every call.
 */
export function enumerateTheoryCells(
  curriculum: readonly GrammarPoint[],
): TheoryCell[] {
  const cells: TheoryCell[] = [];
  for (const entry of curriculum) {
    if (entry.kind !== 'grammar') continue;
    const cellKey = buildTheoryCellKey({
      language: entry.language,
      cefrLevel: entry.cefrLevel,
      grammarPointKey: entry.key,
    });
    cells.push({
      language: entry.language,
      cefrLevel: entry.cefrLevel,
      grammarPoint: entry,
      cellKey,
    });
  }
  return cells;
}
