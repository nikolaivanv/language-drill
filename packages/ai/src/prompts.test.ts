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
    expect(EVALUATION_SYSTEM_PROMPT_VERSION).toBe("evaluate@2026-08-12");
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

// Cloze `options` are an opt-in scaffold in the UI — hidden behind a "show
// answer options" toggle, and revealing them is what sets the submit flag. The
// prompt must not claim the learner saw a list they never opened, nor apply the
// "must be among the Options" narrowing to a free-production answer.
describe("cloze options visibility", () => {
  const clozeWithOptions: ClozeContent = {
    type: ExerciseType.CLOZE,
    instructions: "Fill in the blank.",
    sentence: "Yo siempre ___ en el baño antes de salir de casa.",
    correctAnswer: "me miro",
    options: ["me miro", "te miras", "se mira", "nos miramos"],
  };

  it("omits the option list entirely when the learner did not reveal it", () => {
    const out = buildUserPrompt(
      clozeWithOptions as any,
      "me ducho",
      "ES" as any,
      "B1" as any,
      undefined,
      undefined,
      { optionsRevealed: false },
    );
    expect(out).not.toContain("**Options:**");
    expect(out).not.toContain("te miras");
    // The over-accept guard from PR #612 must not fire — it is only legitimate
    // when the learner actually saw the options.
    expect(out).not.toContain("among the **Options**");
  });

  it("tells the evaluator not to fault the learner for an off-list answer when options were hidden", () => {
    const out = buildUserPrompt(
      clozeWithOptions as any,
      "me ducho",
      "ES" as any,
      "B1" as any,
      undefined,
      undefined,
      { optionsRevealed: false },
    );
    expect(out).toContain("was NOT shown any list of candidate options");
    expect(out).toMatch(/never tell the learner they should have picked from/i);
  });

  it("defaults to hidden when the caller says nothing (UI default is collapsed)", () => {
    const out = buildUserPrompt(clozeWithOptions as any, "me ducho", "ES" as any, "B1" as any);
    expect(out).not.toContain("**Options:**");
    expect(out).toContain("was NOT shown any list of candidate options");
  });

  it("renders the options and keeps the among-options guard once revealed", () => {
    const out = buildUserPrompt(
      clozeWithOptions as any,
      "me ducho",
      "ES" as any,
      "B1" as any,
      undefined,
      undefined,
      { optionsRevealed: true },
    );
    expect(out).toContain("**Options:** me miro, te miras, se mira, nos miramos");
    expect(out).toContain("among the **Options**");
    expect(out).not.toContain("was NOT shown any list of candidate options");
  });

  it("does not claim options exist for an optionless cloze, revealed or not", () => {
    const bare: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "Fill in the blank.",
      sentence: "El portero no ___ entrar.",
      correctAnswer: "dejó",
    };
    for (const optionsRevealed of [true, false]) {
      const out = buildUserPrompt(bare as any, "deja", "ES" as any, "B1" as any, undefined, undefined, {
        optionsRevealed,
      });
      expect(out).not.toContain("**Options:**");
      expect(out).not.toContain("among the **Options**");
    }
  });
});

// A cloze may carry `glossEn` — an English gloss of the sentence's meaning that
// the generator is told to add at A1/A2 as a disambiguation device, and that the
// UI shows the learner (apps/web/components/drill/cloze-prompt.tsx). It was
// rendered to NOBODY downstream, so the evaluator judged a person/tense/referent
// choice the gloss had already fixed, and #612's "any form the sentence licenses
// is correct" rule made that a full-credit answer.
describe("cloze meaning gloss", () => {
  const glossed: ClozeContent = {
    type: ExerciseType.CLOZE,
    instructions: "Fill in the blank with the correct form of the verb.",
    sentence: "No ___ comer la sopa sin sal.",
    correctAnswer: "puedo",
    glossEn: "I can't eat the soup without salt.",
  };

  it("renders the gloss and labels it as learner-visible", () => {
    const out = buildUserPrompt(glossed as any, "puedes", "ES" as any, "A1" as any);
    expect(out).toContain(
      "**Meaning (shown to the learner):** I can't eat the soup without salt.",
    );
  });

  it("names the Meaning line in the visibility clause and makes it binding", () => {
    const out = buildUserPrompt(glossed as any, "puedes", "ES" as any, "A1" as any);
    expect(out).toContain("the **Meaning** line");
    expect(out).toMatch(/contradicts the stated meaning is NOT correct/);
  });

  it("omits the Meaning line and its binding clause for an unglossed cloze", () => {
    const bare: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "Fill in the blank.",
      sentence: "El portero no ___ entrar.",
      correctAnswer: "dejó",
    };
    const out = buildUserPrompt(bare as any, "deja", "ES" as any, "B1" as any);
    expect(out).not.toContain("**Meaning");
    expect(out).not.toContain("contradicts the stated meaning");
  });

  it("treats an empty-string gloss as absent", () => {
    const out = buildUserPrompt(
      { ...glossed, glossEn: "" } as any,
      "puedes",
      "ES" as any,
      "A1" as any,
    );
    expect(out).not.toContain("**Meaning");
  });

  it("keeps the #612 tense-licensing example for an unglossed cloze", () => {
    const bare: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "Fill in the blank.",
      sentence: "El portero no ___ entrar al edificio sin identificación.",
      correctAnswer: "dejó",
    };
    const out = buildUserPrompt(bare as any, "deja", "ES" as any, "B1" as any);
    expect(out).toContain('both the present "deja"');
  });
});
