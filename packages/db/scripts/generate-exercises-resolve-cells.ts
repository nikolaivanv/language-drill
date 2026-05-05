/**
 * Pure cell resolver for `pnpm generate:exercises`.
 *
 * Turns a `ParsedArgs` object plus a curriculum snapshot into the typed list of
 * `Cell` rows the orchestrator iterates over. Pure — no DB, no Claude.
 */

import { ExerciseType, type LearningLanguage } from '@language-drill/shared';

import type { CurriculumCefrLevel, GrammarPoint } from '../src/curriculum';
import { assertValidCellKey } from '../src/lib/cell-key';

import type { ParsedArgs } from './generate-exercises-parse-args';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Cell = {
  language: LearningLanguage;
  cefrLevel: CurriculumCefrLevel;
  exerciseType: ExerciseType;
  grammarPoint: GrammarPoint;
  cellKey: string;
};

// ---------------------------------------------------------------------------
// resolveCells
// ---------------------------------------------------------------------------

const GRAMMAR_KIND_TYPES: ReadonlyArray<ExerciseType> = [
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
];
const VOCAB_KIND_TYPES: ReadonlyArray<ExerciseType> = [ExerciseType.VOCAB_RECALL];
const ALL_TYPES: ReadonlyArray<ExerciseType> = [
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
  ExerciseType.VOCAB_RECALL,
];

export function resolveCells(
  args: ParsedArgs,
  curriculum: readonly GrammarPoint[],
): Cell[] {
  const cells: Cell[] = [];

  if (args.grammarPoint !== null) {
    // Branch 1: single grammar point + concrete type (Task 12 enforces type !== 'all').
    if (args.type === 'all') {
      // Defense-in-depth: parseGenerateArgs already rejects this combo.
      throw new Error(
        "you must scope --type when generating against a single grammar point",
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

    cells.push(buildCell(entry, args.type, args.lang, args.level));
  } else {
    // Branch 2 / 3: filter curriculum to (lang, level), pair with the requested
    // type(s), respecting kind-compatibility.
    const types = args.type === 'all' ? ALL_TYPES : [args.type];
    const matchingEntries = curriculum.filter(
      (g) => g.language === args.lang && g.cefrLevel === args.level,
    );

    for (const entry of matchingEntries) {
      for (const exerciseType of types) {
        if (!isCompatible(entry.kind, exerciseType)) continue;
        cells.push(buildCell(entry, exerciseType, args.lang, args.level));
      }
    }
  }

  if (cells.length === 0) {
    throw new Error(
      `no cells resolved for --lang ${args.lang} --level ${args.level} --type ${args.type}` +
        (args.grammarPoint ? ` --grammar-point ${args.grammarPoint}` : ''),
    );
  }

  return cells;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isCompatible(kind: GrammarPoint['kind'], exerciseType: ExerciseType): boolean {
  const compatible = kind === 'vocab' ? VOCAB_KIND_TYPES : GRAMMAR_KIND_TYPES;
  return compatible.includes(exerciseType);
}

function buildCell(
  entry: GrammarPoint,
  exerciseType: ExerciseType,
  lang: LearningLanguage,
  level: CurriculumCefrLevel,
): Cell {
  const cellKey = `${lang.toLowerCase()}:${level.toLowerCase()}:${exerciseType}:${entry.key}`;
  assertValidCellKey(cellKey);
  return {
    language: lang,
    cefrLevel: level,
    exerciseType,
    grammarPoint: entry,
    cellKey,
  };
}
