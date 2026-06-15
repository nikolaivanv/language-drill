import { describe, expect, it } from "vitest";
import { ExerciseType } from "@language-drill/shared";
import { applicableCoverageTags } from "./coverage-tags";
import type { Cell } from "./cells";

function cellWith(spec: Cell["grammarPoint"]["coverageSpec"]): Cell {
  return {
    cellKey: "tr:a1:cloze:tr-a1-x",
    language: "TR" as Cell["language"],
    cefrLevel: "A1",
    exerciseType: ExerciseType.CLOZE,
    grammarPoint: { coverageSpec: spec } as Cell["grammarPoint"],
  } as Cell;
}

describe("applicableCoverageTags", () => {
  it("keeps person when the cell's spec controls it", () => {
    const cell = cellWith({ axes: [{ name: "person", floors: { "3sg": 5 } }] });
    expect(applicableCoverageTags(cell, { person: "3sg", polarity: "affirmative" })).toEqual({
      person: "3sg",
      polarity: "affirmative",
    });
  });
  it("drops person when the cell has no spec", () => {
    const cell = cellWith(undefined);
    expect(applicableCoverageTags(cell, { person: "3sg", polarity: "affirmative" })).toEqual({
      polarity: "affirmative",
    });
  });

  it("returns null for a dictation cell", () => {
    const cell = {
      cellKey: "ES:B1:dictation:es-b1-dictation",
      language: "ES" as Cell["language"],
      cefrLevel: "B1",
      exerciseType: ExerciseType.DICTATION,
      grammarPoint: {
        key: "es-b1-dictation",
        kind: "dictation",
        coverageSpec: undefined,
      } as Cell["grammarPoint"],
    } as Cell;
    expect(applicableCoverageTags(cell, {})).toBeNull();
  });
});
