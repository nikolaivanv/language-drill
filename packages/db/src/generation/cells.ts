/**
 * Cross-product enumeration of every `(grammarPoint, compatible exerciseType)`
 * cell in the curriculum, plus the round-1 CEFR-level constant.
 *
 * Phase 4 introduces this helper as the *canonical* cell-universe builder.
 * Both the scheduler Lambda (`infra/lambda/src/generation/scheduler.ts`) and
 * the CLI's `resolveCells` (`packages/db/scripts/generate-exercises-resolve-cells.ts`)
 * call into it — keeping the two trigger paths from drifting on which cells
 * exist as the curriculum evolves.
 */

import { ExerciseType, type LearningLanguage } from '@language-drill/shared';

import type { CurriculumCefrLevel, GrammarPoint } from '../curriculum';
import { assertValidCellKey, buildCellKey } from '../lib/cell-key';

// ---------------------------------------------------------------------------
// Round-1 scope (per plan §5)
// ---------------------------------------------------------------------------

/**
 * The CEFR levels Phase 4 targets. Curriculum entries at C1 / C2 are skipped
 * silently by the scheduler (Req 4.5) and rejected by the Lambda's per-message
 * guard (Req 2.7). Phase 6 widens this constant.
 */
export const ROUND_1_CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;
export type Round1CefrLevel = typeof ROUND_1_CEFR_LEVELS[number];

// ---------------------------------------------------------------------------
// Cell type (canonical)
// ---------------------------------------------------------------------------

/**
 * One cell in the curriculum × exercise-type cross-product. The same shape the
 * Phase 2 CLI's `resolveCells` produces; lives here in `packages/db/src/`
 * (rather than `packages/db/scripts/`) so the Lambda can import it through the
 * package barrel.
 */
export type Cell = {
  language: LearningLanguage;
  cefrLevel: CurriculumCefrLevel;
  exerciseType: ExerciseType;
  grammarPoint: GrammarPoint;
  cellKey: string;
};

// ---------------------------------------------------------------------------
// Kind compatibility (Phase 2 invariant)
// ---------------------------------------------------------------------------

const GRAMMAR_KIND_TYPES: ReadonlyArray<ExerciseType> = [
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
];
const GRAMMAR_CLOZE_UNSUITABLE_TYPES: ReadonlyArray<ExerciseType> = [
  ExerciseType.TRANSLATION,
];
const VOCAB_KIND_TYPES: ReadonlyArray<ExerciseType> = [ExerciseType.VOCAB_RECALL];
const DICTATION_KIND_TYPES: ReadonlyArray<ExerciseType> = [ExerciseType.DICTATION];
const FREE_WRITING_KIND_TYPES: ReadonlyArray<ExerciseType> = [ExerciseType.FREE_WRITING];
const PARAPHRASE_KIND_TYPES: ReadonlyArray<ExerciseType> = [
  ExerciseType.CONTEXTUAL_PARAPHRASE,
];

export function compatibleTypes(entry: GrammarPoint): ReadonlyArray<ExerciseType> {
  if (entry.kind === 'dictation') return DICTATION_KIND_TYPES;
  if (entry.kind === 'free-writing') return FREE_WRITING_KIND_TYPES;
  if (entry.kind === 'vocab') return VOCAB_KIND_TYPES;
  if (entry.kind === 'paraphrase') return PARAPHRASE_KIND_TYPES;
  // `clozeUnsuitable` grammar points drop the cloze cell (the blank's answer is
  // leaked by the other half of the construction, or near-synonym alternants
  // both fit) and keep only `translation`.
  const base = entry.clozeUnsuitable ? GRAMMAR_CLOZE_UNSUITABLE_TYPES : GRAMMAR_KIND_TYPES;
  // `sentenceConstructionSuitable` appends a sentence_construction cell to whatever
  // the base set is (cloze+translation or translation-only).
  const withSc = entry.sentenceConstructionSuitable
    ? [...base, ExerciseType.SENTENCE_CONSTRUCTION]
    : base;
  // `conjugationSuitable` appends a conjugation cell after sentence-construction
  // handling (verb-paradigm points that benefit from a dedicated inflection drill).
  return entry.conjugationSuitable
    ? [...withSc, ExerciseType.CONJUGATION]
    : withSc;
}

// ---------------------------------------------------------------------------
// enumerateCurriculumCells
// ---------------------------------------------------------------------------

/**
 * Enumerate every `(grammarPoint, exerciseType)` cell the curriculum supports.
 * Vocab umbrellas are paired only with `vocab_recall`; dictation umbrellas
 * (`kind: 'dictation'`) are paired only with `dictation`; grammar points are
 * paired with `cloze` and `translation`. Order: curriculum order, then within
 * each entry the kind-compatible types in array order.
 *
 * Pure — no DB, no I/O. Output is freshly allocated on every call so callers
 * can sort / filter without aliasing concerns.
 */
export function enumerateCurriculumCells(
  curriculum: readonly GrammarPoint[],
): Cell[] {
  const cells: Cell[] = [];
  for (const entry of curriculum) {
    for (const exerciseType of compatibleTypes(entry)) {
      const cellKey = buildCellKey({
        language: entry.language,
        cefrLevel: entry.cefrLevel,
        exerciseType,
        grammarPointKey: entry.key,
      });
      assertValidCellKey(cellKey);
      cells.push({
        language: entry.language,
        cefrLevel: entry.cefrLevel,
        exerciseType,
        grammarPoint: entry,
        cellKey,
      });
    }
  }
  return cells;
}
