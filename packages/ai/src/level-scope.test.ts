import { describe, it, expect } from "vitest";
import { CefrLevel, ExerciseType, Language } from "@language-drill/shared";
// db imports are allowed in TEST files (excluded from tsc); the helper resolves
// the points the production caller injects via the spec.
import { getGrammarPoint, grammarPointsAtOrBelow } from "@language-drill/db";
import { renderLevelScopeSection } from "./level-scope.js";

// A known TR A1 grammar point — must appear in an A2 cell's scope (at/below).
const a1 = getGrammarPoint("tr-a1-locative");
if (!a1) throw new Error("test fixture missing: tr-a1-locative");

const trA2Points = grammarPointsAtOrBelow(Language.TR, CefrLevel.A2);

describe("renderLevelScopeSection", () => {
  it("renders a scope block for a grammar-anchored type, grouped by level", () => {
    const out = renderLevelScopeSection(ExerciseType.CLOZE, Language.TR, CefrLevel.A2, trA2Points);
    expect(out).toContain("Grammar in this learner's scope");
    expect(out).toContain("CEFR ≤ A2");
    expect(out).toContain(a1.name); // an A1 point appears in the A2 scope
    expect(out).toMatch(/- A1:/);
    expect(out).toMatch(/- A2:/);
    expect(out).toContain("Obligatory morphology");
    expect(out.endsWith("\n\n")).toBe(true); // splices cleanly into the template
  });

  it("returns '' for a non-grammar-anchored type even when points are supplied (gate)", () => {
    expect(renderLevelScopeSection(ExerciseType.VOCAB_RECALL, Language.TR, CefrLevel.A2, trA2Points)).toBe("");
  });

  it("returns '' when no points are supplied (e.g. ES A1, grammar disabled)", () => {
    expect(renderLevelScopeSection(ExerciseType.CLOZE, Language.ES, CefrLevel.A1, [])).toBe("");
    expect(renderLevelScopeSection(ExerciseType.CLOZE, Language.TR, CefrLevel.A2, undefined)).toBe("");
  });

  it("applies to all four grammar-anchored types", () => {
    for (const t of [ExerciseType.CLOZE, ExerciseType.TRANSLATION, ExerciseType.SENTENCE_CONSTRUCTION, ExerciseType.CONJUGATION]) {
      expect(renderLevelScopeSection(t, Language.TR, CefrLevel.A2, trA2Points)).toContain("learner's scope");
    }
  });
});
