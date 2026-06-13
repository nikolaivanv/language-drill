import { describe, expect, it } from "vitest";

import { ExerciseType, Language, CefrLevel } from "@language-drill/shared";

import { applicableCoverageTags } from "./coverage-tags";

function cell(exerciseType: ExerciseType, personRotation: boolean) {
  return {
    language: Language.TR,
    cefrLevel: CefrLevel.A1,
    exerciseType,
    grammarPoint: {
      key: "tr-a1-test",
      ...(personRotation ? { personRotation: true } : {}),
    },
  } as unknown as Parameters<typeof applicableCoverageTags>[0];
}

describe("applicableCoverageTags", () => {
  it("vocab cell keeps only wordClass", () => {
    expect(
      applicableCoverageTags(cell(ExerciseType.VOCAB_RECALL, false), {
        wordClass: "verb",
        polarity: "negative",
      }),
    ).toEqual({ wordClass: "verb" });
  });

  it("personRotation grammar cell keeps person + polarity + sentenceType", () => {
    expect(
      applicableCoverageTags(cell(ExerciseType.CLOZE, true), {
        person: "2pl",
        polarity: "affirmative",
        sentenceType: "interrogative",
        wordClass: "noun",
      }),
    ).toEqual({
      person: "2pl",
      polarity: "affirmative",
      sentenceType: "interrogative",
    });
  });

  it("non-personRotation grammar cell drops person", () => {
    expect(
      applicableCoverageTags(cell(ExerciseType.CLOZE, false), {
        person: "2pl",
        polarity: "negative",
      }),
    ).toEqual({ polarity: "negative" });
  });

  it("returns null when nothing applicable is present", () => {
    expect(
      applicableCoverageTags(cell(ExerciseType.CLOZE, true), {
        wordClass: "noun",
      }),
    ).toBeNull();
  });
});
