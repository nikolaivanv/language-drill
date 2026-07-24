/**
 * Tests for attribution prompt wiring (Tasks A2 + A3).
 * Minimal translation fixture copied from evaluate.test.ts.
 */
import { describe, expect, it } from "vitest";
import { buildUserPrompt, EVALUATION_SYSTEM_PROMPT, EVALUATION_SYSTEM_PROMPT_VERSION } from "./prompts.js";
import { ExerciseType, Language, CefrLevel } from "@language-drill/shared";
import type { TranslationContent, ClozeContent, VocabRecallContent } from "@language-drill/shared";

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
    expect(EVALUATION_SYSTEM_PROMPT_VERSION).toBe("evaluate@2026-07-24");
  });

  it("requires morpheme-level verification before declaring an answer correct", () => {
    expect(EVALUATION_SYSTEM_PROMPT).toMatch(/morpheme by morpheme/i);
  });

  it("forbids reciting suffix paradigms in feedback", () => {
    expect(EVALUATION_SYSTEM_PROMPT).toMatch(/never recite/i);
    expect(EVALUATION_SYSTEM_PROMPT).toMatch(/paradigm/i);
  });

  it("forbids guessing learner intent from accidental real words", () => {
    expect(EVALUATION_SYSTEM_PROMPT).toMatch(/presumed intent|do not assume the learner meant/i);
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

describe("anti-anchoring blocks", () => {
  const cloze: ClozeContent = {
    type: ExerciseType.CLOZE,
    instructions: "Fill in the blank.",
    sentence: "El portero no ___ entrar al edificio sin identificación.",
    correctAnswer: "dejó",
  };
  const vocab: VocabRecallContent = {
    type: ExerciseType.VOCAB_RECALL,
    instructions: "Recall the word.",
    prompt: "the person who guards a door",
    expectedWord: "portero",
    hints: ["works at an entrance"],
    exampleSentence: "El ___ abrió la puerta.",
  };

  it("cloze prompt states what the learner saw and forbids inventing context", () => {
    const out = buildUserPrompt(cloze as any, "deja", "ES" as any, "B1" as any);
    expect(out).toContain("Judge the user's answer as a response to what they actually saw");
    expect(out).toContain('both the present "deja"');
    expect(out).toMatch(/Do NOT invent unstated context/);
  });

  it("vocab_recall prompt judges a valid synonym on the visible prompt, not the reference", () => {
    const out = buildUserPrompt(vocab as any, "guardia", "ES" as any, "B1" as any);
    expect(out).toContain("judge it on whether it satisfies what the learner saw");
  });
});
