import { describe, expect, it } from "vitest";

import { ExerciseType } from "./index";
import {
  COVERAGE_AXIS_VALUES,
  PERSON_CODES,
  coverageAxesFor,
  pickCoverageTags,
  type CoverageTags,
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
      "person",
      "polarity",
      "sentenceType",
      "wordClass",
    ]);
  });
});

describe("coverageAxesFor", () => {
  it("vocab_recall → wordClass only", () => {
    expect(coverageAxesFor(ExerciseType.VOCAB_RECALL, false)).toEqual([
      "wordClass",
    ]);
  });

  it("grammar cloze without personRotation → polarity + sentenceType", () => {
    expect(coverageAxesFor(ExerciseType.CLOZE, false)).toEqual([
      "polarity",
      "sentenceType",
    ]);
  });

  it("grammar cloze with personRotation → person + polarity + sentenceType", () => {
    expect(coverageAxesFor(ExerciseType.CLOZE, true)).toEqual([
      "person",
      "polarity",
      "sentenceType",
    ]);
  });

  it("translation and sentence_construction behave like grammar cells", () => {
    expect(coverageAxesFor(ExerciseType.TRANSLATION, true)).toEqual([
      "person",
      "polarity",
      "sentenceType",
    ]);
    expect(coverageAxesFor(ExerciseType.SENTENCE_CONSTRUCTION, false)).toEqual([
      "polarity",
      "sentenceType",
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
    expect(pickCoverageTags(coverage, ExerciseType.VOCAB_RECALL, false)).toEqual(
      { wordClass: "verb" },
    );
    expect(pickCoverageTags(coverage, ExerciseType.CLOZE, true)).toEqual({
      person: "2pl",
      polarity: "negative",
    });
  });

  it("returns null when no applicable axis is present", () => {
    expect(
      pickCoverageTags({ wordClass: "noun" }, ExerciseType.CLOZE, true),
    ).toBeNull();
    expect(pickCoverageTags({}, ExerciseType.VOCAB_RECALL, false)).toBeNull();
  });
});
