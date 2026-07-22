import { describe, it, expect } from "vitest";
import { resolveEvaluationGuidance } from "./evaluation-guidance.js";
import { getGrammarPoint, grammarPointsAtOrBelow } from "./curriculum/index.js";

describe("resolveEvaluationGuidance", () => {
  it("returns grammarGuidance from the point and a non-EN attribution set", () => {
    const key = "tr-a1-imperative";
    const gp = getGrammarPoint(key);
    expect(gp).toBeDefined();

    const out = resolveEvaluationGuidance({
      grammarPointKey: key,
      language: "TR",
      difficulty: "A1",
    });

    expect(out.grammarGuidance).toEqual({
      name: gp!.name,
      description: gp!.description,
      commonErrors: gp!.commonErrors,
    });
    const expectedKeys = grammarPointsAtOrBelow("TR", "A1").map((p) => ({
      key: p.key,
      name: p.name,
    }));
    expect(out.attributionKeys).toEqual(expectedKeys);
  });

  it("omits grammarGuidance when grammarPointKey is null", () => {
    const out = resolveEvaluationGuidance({
      grammarPointKey: null,
      language: "TR",
      difficulty: "A1",
    });
    expect(out.grammarGuidance).toBeUndefined();
  });

  it("returns an empty attribution set for EN (not a curriculum-attributed language)", () => {
    const out = resolveEvaluationGuidance({
      grammarPointKey: null,
      language: "EN",
      difficulty: "B1",
    });
    expect(out.attributionKeys).toEqual([]);
  });
});
