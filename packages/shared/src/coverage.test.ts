import { describe, expect, it } from "vitest";

import { ExerciseType } from "./index";
import {
  COVERAGE_AXIS_VALUES,
  PERSON_CODES,
  coverageAxesFor,
  pickCoverageTags,
  type CoverageTags,
  type CoverageSpec,
} from "./coverage";

describe("coverage axis constants", () => {
  it("PERSON_CODES is the canonical six-member superset", () => {
    expect([...PERSON_CODES]).toEqual([
      "1sg",
      "2sg",
      "3sg",
      "1pl",
      "2pl",
      "3pl",
    ]);
  });

  it("COVERAGE_AXIS_VALUES lists every axis", () => {
    expect(Object.keys(COVERAGE_AXIS_VALUES).sort()).toEqual([
      "case",
      "comparison",
      "number",
      "person",
      "polarity",
      "sentenceType",
      "wordClass",
    ]);
  });

  it("exposes case and number axis values", () => {
    expect(COVERAGE_AXIS_VALUES.case).toEqual([
      "nominative",
      "accusative",
      "dative",
      "locative",
      "ablative",
      "genitive",
    ]);
    expect(COVERAGE_AXIS_VALUES.number).toEqual(["singular", "plural"]);
  });

  it("exposes the comparison axis values", () => {
    expect(COVERAGE_AXIS_VALUES.comparison).toEqual([
      "comparative",
      "superlative",
      "equative",
      "less",
    ]);
  });
});

const personSpec: CoverageSpec = { axes: [{ name: "person", floors: { "3sg": 8 } }] };

describe("coverageAxesFor", () => {
  it("vocab_recall → wordClass only", () => {
    expect(coverageAxesFor(ExerciseType.VOCAB_RECALL, undefined)).toEqual([
      "wordClass",
    ]);
  });

  it("grammar cloze without person spec → polarity + sentenceType", () => {
    expect(coverageAxesFor(ExerciseType.CLOZE, undefined)).toEqual([
      "polarity",
      "sentenceType",
    ]);
  });

  it("grammar cloze with person spec → person + polarity + sentenceType", () => {
    expect(coverageAxesFor(ExerciseType.CLOZE, personSpec)).toEqual([
      "person",
      "polarity",
      "sentenceType",
    ]);
  });

  it("translation and sentence_construction behave like grammar cells", () => {
    expect(coverageAxesFor(ExerciseType.TRANSLATION, personSpec)).toEqual([
      "person",
      "polarity",
      "sentenceType",
    ]);
    expect(coverageAxesFor(ExerciseType.SENTENCE_CONSTRUCTION, undefined)).toEqual([
      "polarity",
      "sentenceType",
    ]);
  });

  it("dictation has no coverage axes", () => {
    expect(coverageAxesFor(ExerciseType.DICTATION, undefined)).toEqual([]);
  });

  it("conjugation monitors polarity (no sentenceType) and picks up the spec person axis", () => {
    const spec = { axes: [{ name: "person" as const, floors: { "1pl": 5 } }] };
    expect(coverageAxesFor(ExerciseType.CONJUGATION, spec)).toEqual([
      "person",
      "polarity",
    ]);
  });

  it("conjugation with no spec → polarity only", () => {
    expect(coverageAxesFor(ExerciseType.CONJUGATION, undefined)).toEqual(["polarity"]);
  });

  it("conjugation picks up a spec case axis (plus polarity default)", () => {
    const spec = { axes: [{ name: "case" as const, floors: { dative: 3 } }] };
    expect(coverageAxesFor(ExerciseType.CONJUGATION, spec)).toEqual([
      "case",
      "polarity",
    ]);
  });

  it("conjugation picks up a spec number axis", () => {
    const spec = { axes: [{ name: "number" as const, floors: { plural: 6 } }] };
    expect(coverageAxesFor(ExerciseType.CONJUGATION, spec)).toEqual([
      "number",
      "polarity",
    ]);
  });

  it("grammar cloze with a comparison spec → polarity + sentenceType + comparison (comparison last)", () => {
    const comparisonSpec: CoverageSpec = {
      axes: [{ name: "comparison", floors: { comparative: 12, superlative: 6, less: 2 } }],
    };
    expect(coverageAxesFor(ExerciseType.CLOZE, comparisonSpec)).toEqual([
      "polarity",
      "sentenceType",
      "comparison",
    ]);
  });
});

describe("pickCoverageTags", () => {
  it("keeps only axes applicable to the cell", () => {
    const coverage: CoverageTags = {
      person: "2pl",
      wordClass: "verb",
      polarity: "negative",
    };
    expect(pickCoverageTags(coverage, ExerciseType.VOCAB_RECALL, undefined)).toEqual(
      { wordClass: "verb" },
    );
    expect(pickCoverageTags(coverage, ExerciseType.CLOZE, personSpec)).toEqual({
      person: "2pl",
      polarity: "negative",
    });
  });

  it("returns null when no applicable axis is present", () => {
    expect(
      pickCoverageTags({ wordClass: "noun" }, ExerciseType.CLOZE, personSpec),
    ).toBeNull();
    expect(pickCoverageTags({}, ExerciseType.VOCAB_RECALL, undefined)).toBeNull();
  });
});

describe("coverageAxesFor (spec-driven)", () => {
  const wordClassSpec: CoverageSpec = { axes: [{ name: "wordClass", floors: { noun: 6 } }] };

  it("vocab with no spec → wordClass only", () => {
    expect(coverageAxesFor(ExerciseType.VOCAB_RECALL, undefined)).toEqual(["wordClass"]);
  });
  it("grammar cloze with no spec → polarity + sentenceType (monitoring)", () => {
    expect(coverageAxesFor(ExerciseType.CLOZE, undefined)).toEqual(["polarity", "sentenceType"]);
  });
  it("grammar cloze with person spec → person + polarity + sentenceType (canonical order)", () => {
    expect(coverageAxesFor(ExerciseType.CLOZE, personSpec)).toEqual([
      "person",
      "polarity",
      "sentenceType",
    ]);
  });
  it("vocab with wordClass spec → wordClass (union is a no-op)", () => {
    expect(coverageAxesFor(ExerciseType.VOCAB_RECALL, wordClassSpec)).toEqual(["wordClass"]);
  });
});

describe("pickCoverageTags (spec-driven)", () => {
  it("keeps person when the spec controls it", () => {
    expect(
      pickCoverageTags(
        { person: "2pl", polarity: "affirmative", sentenceType: "declarative" },
        ExerciseType.CLOZE,
        personSpec,
      ),
    ).toEqual({ person: "2pl", polarity: "affirmative", sentenceType: "declarative" });
  });
  it("drops person when no spec controls it", () => {
    expect(
      pickCoverageTags(
        { person: "2pl", polarity: "affirmative" },
        ExerciseType.CLOZE,
        undefined,
      ),
    ).toEqual({ polarity: "affirmative" });
  });
});
