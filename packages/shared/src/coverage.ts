/**
 * Coverage axes — the categorical dimensions the validator reports per draft so
 * the approved pool's distribution can be measured (Pool Coverage Controller,
 * Phase 0). Pure vocabulary + applicability rule; no I/O. Imported by the
 * validator (packages/ai), the persistence path + backfill (packages/db), and
 * tests, so the value sets cannot drift across them.
 */

// Imported from ./index despite index re-exporting this file (a same-package
// cycle): safe because ExerciseType is a TS enum (TDZ-immune) and is only
// referenced inside function bodies here. Keep all ExerciseType uses inside
// functions — a module-scope use would create a real init-order hazard.
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
export const CASE_CODES = [
  "nominative",
  "accusative",
  "dative",
  "locative",
  "ablative",
  "genitive",
] as const;
export const NUMBER_CODES = ["singular", "plural"] as const;
export const COMPARISON_CODES = [
  "comparative",
  "superlative",
  "equative",
  "less",
] as const;

export type PersonCode = (typeof PERSON_CODES)[number];
export type WordClassCode = (typeof WORD_CLASS_CODES)[number];
export type PolarityCode = (typeof POLARITY_CODES)[number];
export type SentenceTypeCode = (typeof SENTENCE_TYPE_CODES)[number];
export type CaseCode = (typeof CASE_CODES)[number];
export type NumberCode = (typeof NUMBER_CODES)[number];
export type ComparisonCode = (typeof COMPARISON_CODES)[number];

export type CoverageAxis =
  | "person"
  | "number"
  | "case"
  | "wordClass"
  | "polarity"
  | "sentenceType"
  | "comparison";

/** The realized coverage values for one exercise; partial — only applicable
 *  axes are ever set. Stored verbatim in `exercises.coverage_tags`. */
export type CoverageTags = {
  person?: PersonCode;
  number?: NumberCode;
  case?: CaseCode;
  wordClass?: WordClassCode;
  polarity?: PolarityCode;
  sentenceType?: SentenceTypeCode;
  comparison?: ComparisonCode;
};

/**
 * Declarative coverage spec for a grammar point (Pool Coverage Controller,
 * Phase 2). Lists which axes a diverse approved set should vary along and an
 * absolute min approved-count `floor` per value. A value omitted from `floors`
 * is "NA" — never targeted (e.g. ES has no `2pl`, so its person specs omit it).
 * A low floor (e.g. 2) is the "rare" case. Replaces the `personRotation` flag.
 */
export type CoverageAxisSpec = {
  name: CoverageAxis;
  floors: Readonly<Partial<Record<string, number>>>;
};
export type CoverageSpec = { axes: readonly CoverageAxisSpec[] };

/** One draft's per-axis assignment from the controller; sparse — only the
 *  cell's controlled (and non-suppressed) axes are present. */
export type CoverageTarget = Partial<Record<CoverageAxis, string>>;

/** `{requested, approved}` tally for one axis's values in a batch. `requested`
 *  = drafts the scheduler targeted at each value; `approved` = approved drafts
 *  whose *realized* value equals it. */
export type AxisOutcome = Partial<
  Record<string, { requested: number; approved: number }>
>;

/**
 * Axis-keyed generation outcome persisted to `generation_jobs.coverage_outcome`
 * (Phase 2, generalized from the Phase-1 `{ person?: … }` shape — old rows are
 * still valid instances). Drives the per-`(axis, value)` give-up in
 * `coverage-decision.ts`. NULL on legacy rows and cells that did no targeting.
 */
export type CoverageOutcome = Partial<Record<CoverageAxis, AxisOutcome>>;

/** Allowed string values per axis — drives the validator tool enum AND the
 *  lenient parser (a value not in this set is dropped, never stored). Prefer
 *  iterating this over the individual *_CODES arrays so callers stay in sync. */
export const COVERAGE_AXIS_VALUES: Record<CoverageAxis, readonly string[]> = {
  person: PERSON_CODES,
  number: NUMBER_CODES,
  case: CASE_CODES,
  wordClass: WORD_CLASS_CODES,
  polarity: POLARITY_CODES,
  sentenceType: SENTENCE_TYPE_CODES,
  comparison: COMPARISON_CODES,
};

/** Canonical axis ordering so `coverageAxesFor` output is stable and matches
 *  the Phase-1 `[person, polarity, sentenceType]` ordering for person cells. */
const AXIS_ORDER: readonly CoverageAxis[] = [
  "person",
  "number",
  "case",
  "wordClass",
  "polarity",
  "sentenceType",
  "comparison",
];

/**
 * Which axes to record for a cell: the per-exercise-type *monitoring* axes
 * UNION the spec's *controlled* axes, returned in canonical order. vocab_recall
 * → wordClass; grammar cloze/translation/sentence_construction → polarity +
 * sentenceType; plus any axis the cell's `coverageSpec` controls.
 */
export function coverageAxesFor(
  exerciseType: ExerciseType,
  spec: CoverageSpec | undefined,
): CoverageAxis[] {
  const monitoring = new Set<CoverageAxis>();
  if (exerciseType === ExerciseType.VOCAB_RECALL) {
    monitoring.add("wordClass");
  } else if (exerciseType === ExerciseType.CONJUGATION) {
    // A conjugation drill produces a single inflected wordform — there is no
    // sentence, so sentenceType (declarative/interrogative/imperative) is
    // meaningless. Monitor polarity only; person comes from the cell's spec.
    monitoring.add("polarity");
  } else if (
    exerciseType === ExerciseType.CLOZE ||
    exerciseType === ExerciseType.TRANSLATION ||
    exerciseType === ExerciseType.SENTENCE_CONSTRUCTION
  ) {
    monitoring.add("polarity");
    monitoring.add("sentenceType");
  }
  if (spec) for (const axis of spec.axes) monitoring.add(axis.name);
  return AXIS_ORDER.filter((a) => monitoring.has(a));
}

/**
 * Filter a raw coverage map down to the axes applicable to the cell. Returns
 * `null` when nothing applicable is present, so callers write the column as
 * `null` rather than `{}`.
 */
export function pickCoverageTags(
  coverage: CoverageTags,
  exerciseType: ExerciseType,
  spec: CoverageSpec | undefined,
): CoverageTags | null {
  const axes = coverageAxesFor(exerciseType, spec);
  const out: CoverageTags = {};
  for (const axis of axes) {
    const v = coverage[axis];
    if (v !== undefined) (out as Record<string, string>)[axis] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}
