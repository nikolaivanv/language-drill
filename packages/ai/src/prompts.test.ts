/**
 * Tests for attribution prompt wiring (Tasks A2 + A3).
 * Minimal translation fixture copied from evaluate.test.ts.
 */
import { describe, expect, it } from "vitest";
import { buildUserPrompt, EVALUATION_SYSTEM_PROMPT, EVALUATION_SYSTEM_PROMPT_VERSION } from "./prompts.js";
import { ExerciseType, Language, CefrLevel } from "@language-drill/shared";
import type { TranslationContent } from "@language-drill/shared";

// Minimal TRANSLATION fixture — matches the shape used in evaluate.test.ts.
const translationContent: TranslationContent = {
  type: ExerciseType.TRANSLATION,
  instructions: "Translate the following sentence.",
  sourceText: "The cat is on the table.",
  sourceLanguage: Language.EN,
  targetLanguage: Language.ES,
  referenceTranslation: "El gato esta en la mesa.",
};

describe("attribution prompt wiring", () => {
  const exercise = translationContent as any;

  it("system prompt instructs per-error grammarPointKey attribution", () => {
    expect(EVALUATION_SYSTEM_PROMPT).toMatch(/grammarPointKey/);
    expect(EVALUATION_SYSTEM_PROMPT).toMatch(/in scope/i);
  });

  it("version is bumped to today", () => {
    expect(EVALUATION_SYSTEM_PROMPT_VERSION).toBe("evaluate@2026-06-20");
  });

  it("appends a Grammar points in scope block when keys are provided", () => {
    const out = buildUserPrompt(exercise, "answer", "TR" as any, "A1" as any, undefined, [
      { key: "tr-a1-vowel-harmony", name: "Vowel harmony" },
      { key: "tr-a1-locative", name: "Locative case" },
    ]);
    expect(out).toMatch(/Grammar points in scope/);
    expect(out).toMatch(/tr-a1-vowel-harmony — Vowel harmony/);
    expect(out).toMatch(/tr-a1-locative — Locative case/);
  });

  it("omits the scope block when no keys are provided", () => {
    const out = buildUserPrompt(exercise, "answer", "TR" as any, "A1" as any);
    expect(out).not.toMatch(/Grammar points in scope/);
  });
});
