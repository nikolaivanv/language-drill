/**
 * Coverage axes — the categorical dimensions the validator reports per draft so
 * the approved pool's distribution can be measured (Pool Coverage Controller,
 * Phase 0). Pure vocabulary + applicability rule; no I/O. Imported by the
 * validator (packages/ai), the persistence path + backfill (packages/db), and
 * tests, so the value sets cannot drift across them.
 */

import { ExerciseType } from "./index";

export const PERSON_CODES = [
  "1sg",
  "2sg",
  "3sg",
  "1pl",
  "2pl",
  "3pl",
] as const;
export const WORD_CLASS_CODES = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "other",
] as const;
export const POLARITY_CODES = ["affirmative", "negative"] as const;
export const SENTENCE_TYPE_CODES = [
  "declarative",
  "interrogative",
  "imperative",
] as const;

export type PersonCode = (typeof PERSON_CODES)[number];
export type WordClassCode = (typeof WORD_CLASS_CODES)[number];
export type PolarityCode = (typeof POLARITY_CODES)[number];
export type SentenceTypeCode = (typeof SENTENCE_TYPE_CODES)[number];

export type CoverageAxis = "person" | "wordClass" | "polarity" | "sentenceType";

/** The realized coverage values for one exercise; partial — only applicable
 *  axes are ever set. Stored verbatim in `exercises.coverage_tags`. */
export type CoverageTags = {
  person?: PersonCode;
  wordClass?: WordClassCode;
  polarity?: PolarityCode;
  sentenceType?: SentenceTypeCode;
};

/** Allowed string values per axis — drives the validator tool enum AND the
 *  lenient parser (a value not in this set is dropped, never stored). */
export const COVERAGE_AXIS_VALUES: Record<CoverageAxis, readonly string[]> = {
  person: PERSON_CODES,
  wordClass: WORD_CLASS_CODES,
  polarity: POLARITY_CODES,
  sentenceType: SENTENCE_TYPE_CODES,
};

/**
 * Which axes are meaningful for a cell. vocab_recall → wordClass; the grammar
 * exercise types (cloze/translation/sentence_construction) → polarity +
 * sentenceType, plus person when the grammar point rotates person. Any other
 * exercise type (listening/speaking) → none.
 */
export function coverageAxesFor(
  exerciseType: ExerciseType,
  personRotation: boolean,
): CoverageAxis[] {
  if (exerciseType === ExerciseType.VOCAB_RECALL) return ["wordClass"];
  if (
    exerciseType === ExerciseType.CLOZE ||
    exerciseType === ExerciseType.TRANSLATION ||
    exerciseType === ExerciseType.SENTENCE_CONSTRUCTION
  ) {
    return personRotation
      ? ["person", "polarity", "sentenceType"]
      : ["polarity", "sentenceType"];
  }
  return [];
}

/**
 * Filter a raw coverage map down to the axes applicable to the cell. Returns
 * `null` when nothing applicable is present, so callers can write the column
 * as `null` rather than `{}`.
 */
export function pickCoverageTags(
  coverage: CoverageTags,
  exerciseType: ExerciseType,
  personRotation: boolean,
): CoverageTags | null {
  const axes = coverageAxesFor(exerciseType, personRotation);
  const out: Record<string, string> = {};
  for (const axis of axes) {
    const v = coverage[axis];
    if (v !== undefined) out[axis] = v;
  }
  return Object.keys(out).length > 0 ? (out as CoverageTags) : null;
}
