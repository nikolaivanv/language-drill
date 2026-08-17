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
import {
  type Cell,
  compatibleTypes,
  enumerateCurriculumCells,
} from '../src/generation/cells';

import type { ParsedArgs } from './generate-exercises-parse-args';

// Re-export `Cell` so existing callers (`generate-exercises.ts`) continue to
// import it from the same path; the canonical type now lives in `src/generation/`.
export type { Cell };

// ---------------------------------------------------------------------------
// Kind compatibility — delegated to `compatibleTypes` (src/generation/cells.ts),
// the same function `enumerateCurriculumCells` builds the universe from.
//
// This file used to keep its own copy of the kind -> types mapping "for the
// single-grammar-point validation branch", with a comment asserting it matched
// the enumerator. It did not: the copy was written before `conjugation`,
// `free-writing` and `paraphrase` existed, hardcoded SENTENCE_CONSTRUCTION into
// the grammar set instead of gating it on `sentenceConstructionSuitable`, and
// ignored `clozeUnsuitable`. Net effect: `--type conjugation` was rejected for
// EVERY point ("kind: grammar is not compatible with --type conjugation") even
// though the scheduler generates those cells nightly, so no conjugation cell
// could be driven from the CLI at all.
//
// A duplicated mapping cannot be kept honest by a comment — the two must be the
// same function. The validation branch below now asks the enumerator's own
// predicate, so a future exercise type is picked up here for free.
// ---------------------------------------------------------------------------

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
    // Checked BEFORE the general compatibility test purely for the error
    // message: `compatibleTypes` already omits SENTENCE_CONSTRUCTION for a point
    // without the flag, but "not compatible with --type sentence_construction"
    // doesn't tell the author that the fix is a curriculum flag.
    if (
      args.type === ExerciseType.SENTENCE_CONSTRUCTION &&
      !entry.sentenceConstructionSuitable
    ) {
      throw new Error(
        `grammar point '${args.grammarPoint}' is not flagged sentenceConstructionSuitable; add the flag in the curriculum to generate sentence_construction exercises for it`,
      );
    }
    // Same shape as the SC flag, for the same reason.
    if (args.type === ExerciseType.CONJUGATION && !entry.conjugationSuitable) {
      throw new Error(
        `grammar point '${args.grammarPoint}' is not flagged conjugationSuitable; add the flag in the curriculum to generate conjugation exercises for it`,
      );
    }
    if (!compatibleTypes(entry).includes(args.type)) {
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
