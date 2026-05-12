/**
 * Pure cell resolver for `pnpm generate:theory`.
 *
 * Turns a `ParsedTheoryArgs` object plus a curriculum snapshot into the typed
 * list of `TheoryCell` rows the theory CLI iterates over. Pure — no DB calls,
 * no Claude calls; testable in isolation.
 *
 * Structural mirror of `generate-exercises-resolve-cells.ts`, minus the
 * per-`--type` cross-product: theory has no exercise-type axis (Req 5.1) — one
 * explainer per (lang, level, grammar-point) cell.
 */

import type { GrammarPoint } from '../src/curriculum';
import { enumerateTheoryCells, type TheoryCell } from '../src/theory-generation/cells';

import type { ParsedTheoryArgs } from './generate-theory-parse-args';

// Re-export `TheoryCell` so existing callers (`generate-theory.ts`) can
// import it from the same path; the canonical type lives in
// `src/theory-generation/cells`.
export type { TheoryCell };

// ---------------------------------------------------------------------------
// resolveTheoryCells
// ---------------------------------------------------------------------------

export function resolveTheoryCells(
  args: ParsedTheoryArgs,
  curriculum: readonly GrammarPoint[],
): TheoryCell[] {
  const universe = enumerateTheoryCells(curriculum);

  if (args.grammarPoint !== null) {
    // Single-grammar-point branch: validate the explicit argument against the
    // curriculum entry, then pick the matching cell from the universe.
    //
    // The curriculum lookup runs against the FULL curriculum (not the filtered
    // universe), so vocab entries are findable here; the explicit vocab check
    // below then rejects them with the proper message. Order matters:
    //   1. missing-from-curriculum
    //   2. language mismatch
    //   3. level mismatch
    //   4. vocab umbrella reject
    //   5. universe lookup (guaranteed to succeed after the four pre-checks)
    const entry = curriculum.find((g) => g.key === args.grammarPoint);
    if (!entry) {
      throw new Error(`--grammar-point '${args.grammarPoint}' not in curriculum`);
    }
    if (entry.language !== args.lang) {
      throw new Error(
        `--grammar-point '${args.grammarPoint}' is for language ${entry.language}, not --lang ${args.lang}`,
      );
    }
    if (args.level !== 'all' && entry.cefrLevel !== args.level) {
      throw new Error(
        `--grammar-point '${args.grammarPoint}' is at CEFR ${entry.cefrLevel}, not --level ${args.level}`,
      );
    }
    if (entry.kind === 'vocab') {
      throw new Error(
        `--grammar-point '${args.grammarPoint}' is a vocab umbrella (kind 'vocab'); theory generation supports only grammar points in round 1 (resolved decision #6)`,
      );
    }

    // The four pre-checks confirmed `entry.kind === 'grammar'` and the entry's
    // language/level are compatible — so `enumerateTheoryCells` must have
    // produced a cell for it. Non-null assertion is safe here.
    const cell = universe.find((c) => c.grammarPoint.key === args.grammarPoint)!;
    return [cell];
  }

  // Multi-cell branch: slice the universe by (lang, level).
  const matched = universe.filter(
    (c) =>
      c.language === args.lang &&
      (args.level === 'all' || c.cefrLevel === args.level),
  );

  if (matched.length === 0) {
    throw new Error(
      `no cells resolved for --lang ${args.lang} --level ${args.level}`,
    );
  }

  return matched;
}
