import { describe, it, expect } from "vitest";
import {
  CefrLevel,
  ExerciseType,
  Language,
  type ClozeContent,
  type TranslationContent,
  type VocabRecallContent,
} from "@language-drill/shared";
import { getGrammarPoint } from "@language-drill/db";

import { CEFR_LEVEL_DESCRIPTORS, EVALUATION_SYSTEM_PROMPT } from "./prompts.js";
import {
  MAX_RECENT_STEMS_IN_PROMPT,
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  canonicalSurface,
  tailRecentStems,
  type GenerationPromptInputs,
} from "./generation-prompts.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const grammarPoint = getGrammarPoint("es-b1-present-subjunctive");
if (!grammarPoint) {
  throw new Error(
    "test fixture missing: curriculum entry 'es-b1-present-subjunctive'",
  );
}

const baseInputs: GenerationPromptInputs = {
  language: Language.ES,
  cefrLevel: CefrLevel.B1,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint,
};

// ---------------------------------------------------------------------------
// buildGenerationSystemPrompt
// ---------------------------------------------------------------------------

describe("buildGenerationSystemPrompt", () => {
  it("is deterministic — same (inputs, recentStems) returns identical bytes", () => {
    const a = buildGenerationSystemPrompt(baseInputs, ["stem one", "stem two"]);
    const b = buildGenerationSystemPrompt(baseInputs, ["stem one", "stem two"]);
    expect(a).toBe(b);
  });

  it("renders '(none yet)' when recentStems is empty", () => {
    const prompt = buildGenerationSystemPrompt(baseInputs, []);
    expect(prompt).toContain("(none yet)");
  });

  it("renders one bullet per stem when recentStems is non-empty", () => {
    const stems = ["primera frase", "segunda frase", "tercera frase"];
    const prompt = buildGenerationSystemPrompt(baseInputs, stems);
    for (const stem of stems) {
      expect(prompt).toContain(`- ${stem}`);
    }
    expect(prompt).not.toContain("(none yet)");
  });

  it("inlines the grammar-point name, description, examples, and common errors verbatim", () => {
    const prompt = buildGenerationSystemPrompt(baseInputs, []);
    expect(prompt).toContain(grammarPoint.name);
    expect(prompt).toContain(grammarPoint.description);
    for (const example of grammarPoint.examplesPositive) {
      expect(prompt).toContain(example);
    }
    for (const example of grammarPoint.examplesNegative) {
      expect(prompt).toContain(example);
    }
    for (const error of grammarPoint.commonErrors) {
      expect(prompt).toContain(error);
    }
  });

  it("interpolates the language and CEFR level into the header and constraints", () => {
    const prompt = buildGenerationSystemPrompt(baseInputs, []);
    expect(prompt).toContain("ES learners at CEFR B1");
    expect(prompt).toContain(
      "Vocabulary outside CEFR B1 is forbidden unless the exercise explicitly tests it.",
    );
  });

  it("instructs Claude to use the matching tool name", () => {
    const cloze = buildGenerationSystemPrompt(baseInputs, []);
    expect(cloze).toContain("submit_cloze_exercise");

    const translation = buildGenerationSystemPrompt(
      { ...baseInputs, exerciseType: ExerciseType.TRANSLATION },
      [],
    );
    expect(translation).toContain("submit_translation_exercise");

    const vocab = buildGenerationSystemPrompt(
      { ...baseInputs, exerciseType: ExerciseType.VOCAB_RECALL },
      [],
    );
    expect(vocab).toContain("submit_vocab_recall_exercise");
  });

  it("shares CEFR descriptors with EVALUATION_SYSTEM_PROMPT (DRY invariant)", () => {
    const b1Descriptor = CEFR_LEVEL_DESCRIPTORS[CefrLevel.B1];
    const generatorPrompt = buildGenerationSystemPrompt(baseInputs, []);
    expect(generatorPrompt).toContain(b1Descriptor);
    expect(EVALUATION_SYSTEM_PROMPT).toContain(b1Descriptor);
  });

  it("truncates recentStems beyond MAX_RECENT_STEMS_IN_PROMPT", () => {
    const stems = Array.from({ length: 32 }, (_, i) => `stem-${i}`);
    const prompt = buildGenerationSystemPrompt(baseInputs, stems);
    // First two should be dropped (LRU keeps the tail of 30).
    expect(prompt).not.toContain("stem-0\n");
    expect(prompt).not.toContain("stem-1\n");
    // Last 30 should survive.
    expect(prompt).toContain("stem-2");
    expect(prompt).toContain("stem-31");
  });
});

// ---------------------------------------------------------------------------
// buildGenerationUserPrompt
// ---------------------------------------------------------------------------

describe("buildGenerationUserPrompt", () => {
  it("renders 'mixed' when topicDomain is null", () => {
    const prompt = buildGenerationUserPrompt(baseInputs, 0, null);
    expect(prompt).toContain("Topic domain: mixed");
  });

  it("renders the supplied topicDomain", () => {
    const prompt = buildGenerationUserPrompt(baseInputs, 0, "travel");
    expect(prompt).toContain("Topic domain: travel");
  });

  it("displays the ordinal as 1-indexed", () => {
    expect(buildGenerationUserPrompt(baseInputs, 0, null)).toContain(
      "Produce exercise #1.",
    );
    expect(buildGenerationUserPrompt(baseInputs, 49, null)).toContain(
      "Produce exercise #50.",
    );
  });

  it("names the matching tool", () => {
    expect(
      buildGenerationUserPrompt(baseInputs, 0, null),
    ).toContain("submit_cloze_exercise");
    expect(
      buildGenerationUserPrompt(
        { ...baseInputs, exerciseType: ExerciseType.TRANSLATION },
        0,
        null,
      ),
    ).toContain("submit_translation_exercise");
  });
});

// ---------------------------------------------------------------------------
// canonicalSurface
// ---------------------------------------------------------------------------

describe("canonicalSurface", () => {
  it("lowercases and strips diacritics from a cloze sentence", () => {
    const content: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "x",
      sentence: "Yo HABLO españól.",
      correctAnswer: "x",
    };
    expect(canonicalSurface(content)).toBe("yo hablo espanol.");
  });

  it("uses sourceText for translation content", () => {
    const content: TranslationContent = {
      type: ExerciseType.TRANSLATION,
      instructions: "x",
      sourceText: "The Cat is on the Mat.",
      sourceLanguage: Language.EN,
      targetLanguage: Language.ES,
      referenceTranslation: "El gato está sobre la alfombra.",
    };
    expect(canonicalSurface(content)).toBe("the cat is on the mat.");
  });

  it("uses expectedWord for vocab content", () => {
    const content: VocabRecallContent = {
      type: ExerciseType.VOCAB_RECALL,
      instructions: "x",
      prompt: "x",
      expectedWord: "Subjuntivo",
      hints: [],
      exampleSentence: "x",
    };
    expect(canonicalSurface(content)).toBe("subjuntivo");
  });

  it("collapses internal whitespace runs to a single space", () => {
    const content: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "x",
      sentence: "Yo  HABLO   españól.",
      correctAnswer: "x",
    };
    expect(canonicalSurface(content)).toBe("yo hablo espanol.");
  });

  it("trims leading and trailing whitespace", () => {
    const content: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "x",
      sentence: "  espero que llegues a tiempo.  ",
      correctAnswer: "llegues",
    };
    expect(canonicalSurface(content)).toBe("espero que llegues a tiempo.");
  });

  it("treats tabs and newlines as whitespace via \\s", () => {
    const content: TranslationContent = {
      type: ExerciseType.TRANSLATION,
      instructions: "x",
      sourceText: "I\thope\nyou arrive on time.",
      sourceLanguage: Language.EN,
      targetLanguage: Language.ES,
      referenceTranslation: "Espero que llegues a tiempo.",
    };
    expect(canonicalSurface(content)).toBe("i hope you arrive on time.");
  });
});

// ---------------------------------------------------------------------------
// tailRecentStems
// ---------------------------------------------------------------------------

describe("tailRecentStems", () => {
  it("returns the input as-is when within the cap", () => {
    const stems = ["a", "b", "c"];
    expect(tailRecentStems(stems)).toEqual(stems);
  });

  it("returns the last 30 of 32", () => {
    const stems = Array.from({ length: 32 }, (_, i) => `s${i}`);
    const tail = tailRecentStems(stems);
    expect(tail).toHaveLength(MAX_RECENT_STEMS_IN_PROMPT);
    expect(tail[0]).toBe("s2");
    expect(tail[tail.length - 1]).toBe("s31");
  });

  it("returns an empty array when input is empty", () => {
    expect(tailRecentStems([])).toEqual([]);
  });
});
