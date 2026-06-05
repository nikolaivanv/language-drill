import { describe, it, expect } from "vitest";
import { Language, CefrLevel, READING_TOO_HARD_THRESHOLD } from "@language-drill/shared";
import { scoreTextLevel } from "./reading-level-check.js";

describe("scoreTextLevel", () => {
  it("returns a fraction in [0,1] and a tooHard flag", () => {
    const result = scoreTextLevel({
      language: Language.ES,
      cefr: CefrLevel.A1,
      text: "El gato come pan. La casa es grande.",
    });
    expect(result.aboveLevelFraction).toBeGreaterThanOrEqual(0);
    expect(result.aboveLevelFraction).toBeLessThanOrEqual(1);
    expect(typeof result.tooHard).toBe("boolean");
  });

  it("flags a text stuffed with rare words as too hard at A1", () => {
    const result = scoreTextLevel({
      language: Language.ES,
      cefr: CefrLevel.A1,
      text: "La idiosincrasia epistemológica subvierte la hermenéutica contemporánea.",
    });
    expect(result.aboveLevelFraction).toBeGreaterThan(READING_TOO_HARD_THRESHOLD);
    expect(result.tooHard).toBe(true);
  });

  it("treats an empty text as not too hard (no content words)", () => {
    const result = scoreTextLevel({
      language: Language.ES,
      cefr: CefrLevel.A1,
      text: "   ",
    });
    expect(result.aboveLevelFraction).toBe(0);
    expect(result.tooHard).toBe(false);
  });
});
