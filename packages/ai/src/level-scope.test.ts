import { describe, it, expect } from "vitest";
import { CefrLevel, ExerciseType, Language } from "@language-drill/shared";
import { getGrammarPoint } from "@language-drill/db";
import { renderLevelScopeSection } from "./level-scope.js";

// A known TR A1 grammar point — must appear in an A2 cell's scope (at/below).
const a1 = getGrammarPoint("tr-a1-locative");
if (!a1) throw new Error("test fixture missing: tr-a1-locative");

describe("renderLevelScopeSection", () => {
  it("renders a scope block for a grammar-anchored type, grouped by level", () => {
    const out = renderLevelScopeSection(ExerciseType.CLOZE, Language.TR, CefrLevel.A2);
    expect(out).toContain("Grammar in this learner's scope");
    expect(out).toContain("CEFR ≤ A2");
    expect(out).toContain(a1.name); // an A1 point appears in the A2 scope
    expect(out).toMatch(/- A1:/);
    expect(out).toMatch(/- A2:/);
    expect(out).toContain("Obligatory morphology");
    expect(out.endsWith("\n\n")).toBe(true); // splices cleanly into the template
  });

  it("returns '' for a non-grammar-anchored type (gate)", () => {
    expect(renderLevelScopeSection(ExerciseType.VOCAB_RECALL, Language.TR, CefrLevel.A2)).toBe("");
  });

  it("returns '' when the language/level has no grammar points (e.g. ES A1)", () => {
    // ES A1 grammar is currently disabled → empty scope → omit the section.
    expect(renderLevelScopeSection(ExerciseType.CLOZE, Language.ES, CefrLevel.A1)).toBe("");
  });

  it("applies to all four grammar-anchored types", () => {
    for (const t of [ExerciseType.CLOZE, ExerciseType.TRANSLATION, ExerciseType.SENTENCE_CONSTRUCTION, ExerciseType.CONJUGATION]) {
      expect(renderLevelScopeSection(t, Language.TR, CefrLevel.A2)).toContain("learner's scope");
    }
  });
});
