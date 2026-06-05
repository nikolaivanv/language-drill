/**
 * Pure cell resolver for `pnpm generate:exercises`.
 *
 * Turns a `ParsedArgs` object plus a curriculum snapshot into the typed list of
 * `Cell` rows the orchestrator iterates over. Pure — no DB, no Claude.
 *
 * Phase 4 extracted the cross-product enumeration into
 * `packages/db/src/generation/cells.ts`'s `enumerateCurriculumCells` so the
 * scheduler Lambda + this CLI cannot drift on which cells exist. `resolveCells`
 * is now a thin slicer over that universe + the existing single-grammar-point
 * validation paths.
 */

import { ExerciseType } from '@language-drill/shared';

import type { GrammarPoint } from '../src/curriculum';
import { type Cell, enumerateCurriculumCells } from '../src/generation/cells';

import type { ParsedArgs } from './generate-exercises-parse-args';

// Re-export `Cell` so existing callers (`generate-exercises.ts`) continue to
// import it from the same path; the canonical type now lives in `src/generation/`.
export type { Cell };

// ---------------------------------------------------------------------------
// Kind compatibility (kept here only for the single-grammar-point validation
// branch — the universe enumeration uses the same compatibility rules inside
// `enumerateCurriculumCells`).
// ---------------------------------------------------------------------------

const GRAMMAR_KIND_TYPES: ReadonlyArray<ExerciseType> = [
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
  ExerciseType.SENTENCE_CONSTRUCTION,
];
const VOCAB_KIND_TYPES: ReadonlyArray<ExerciseType> = [ExerciseType.VOCAB_RECALL];

function isCompatible(kind: GrammarPoint['kind'], exerciseType: ExerciseType): boolean {
  const compatible = kind === 'vocab' ? VOCAB_KIND_TYPES : GRAMMAR_KIND_TYPES;
  return compatible.includes(exerciseType);
}

// ---------------------------------------------------------------------------
// resolveCells
// ---------------------------------------------------------------------------

export function resolveCells(
  args: ParsedArgs,
  curriculum: readonly GrammarPoint[],
): Cell[] {
  const universe = enumerateCurriculumCells(curriculum);

  if (args.grammarPoint !== null) {
    // Branch 1: single grammar point + concrete type. Validate the explicit
    // arguments against the curriculum entry, then pick the matching cell from
    // the universe.
    if (args.type === 'all') {
      // Defense-in-depth: parseGenerateArgs already rejects this combo.
      throw new Error(
        'you must scope --type when generating against a single grammar point',
      );
    }

    const entry = curriculum.find((g) => g.key === args.grammarPoint);
    if (!entry) {
      throw new Error(`--grammar-point '${args.grammarPoint}' not in curriculum`);
    }
    if (entry.language !== args.lang) {
      throw new Error(
        `--grammar-point '${args.grammarPoint}' is for language ${entry.language}, not --lang ${args.lang}`,
      );
    }
    if (entry.cefrLevel !== args.level) {
      throw new Error(
        `--grammar-point '${args.grammarPoint}' is at CEFR ${entry.cefrLevel}, not --level ${args.level}`,
      );
    }
    if (!isCompatible(entry.kind, args.type)) {
      throw new Error(
        `--grammar-point '${args.grammarPoint}' (kind: ${entry.kind}) is not compatible with --type ${args.type}`,
      );
    }

    // The (grammarPoint, type) pair is valid → it must exist in the universe.
    const cell = universe.find(
      (c) => c.grammarPoint.key === args.grammarPoint && c.exerciseType === args.type,
    );
    if (!cell) {
      throw new Error(
        `internal: enumerateCurriculumCells did not produce a cell for ${args.grammarPoint}/${args.type}`,
      );
    }
    return [cell];
  }

  // Branch 2 / 3: slice the universe by (lang, level, type).
  const typeFilter = args.type === 'all' ? null : args.type;
  const matched = universe.filter(
    (c) =>
      c.language === args.lang &&
      c.cefrLevel === args.level &&
      (typeFilter === null || c.exerciseType === typeFilter),
  );

  if (matched.length === 0) {
    throw new Error(
      `no cells resolved for --lang ${args.lang} --level ${args.level} --type ${args.type}` +
        (args.grammarPoint ? ` --grammar-point ${args.grammarPoint}` : ''),
    );
  }

  return matched;
}
