import { describe, it, expect } from "vitest";
import {
  CefrLevel,
  type ExerciseContent,
  ExerciseType,
  Language,
  type ClozeContent,
  type TranslationContent,
  type VocabRecallContent,
} from "@language-drill/shared";
import { getGrammarPoint } from "@language-drill/db";

import { CEFR_LEVEL_DESCRIPTORS, EVALUATION_SYSTEM_PROMPT } from "./prompts.js";
import type { ExerciseDraft, GenerationSpec } from "./generate.js";
import {
  buildValidationSystemPrompt,
  buildValidationUserPrompt,
  VALIDATION_SYSTEM_PROMPT_TEMPLATE,
} from "./validation-prompts.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const grammarPoint = getGrammarPoint("es-b1-present-subjunctive");
if (!grammarPoint) {
  throw new Error(
    "test fixture missing: curriculum entry 'es-b1-present-subjunctive'",
  );
}

const baseSpec: GenerationSpec = {
  language: Language.ES,
  cefrLevel: CefrLevel.B1,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint,
  topicDomain: null,
  count: 1,
  batchSeed: "test-seed",
};

function makeDraft(content: ExerciseContent): ExerciseDraft {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    contentJson: content,
    metadata: {
      grammarPointKey: grammarPoint!.key,
      topicDomain: null,
      modelId: "claude-sonnet-4-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      inBatchDuplicate: false,
    },
  };
}

// ---------------------------------------------------------------------------
// buildValidationSystemPrompt
// ---------------------------------------------------------------------------

describe("buildValidationSystemPrompt", () => {
  it("is deterministic — same spec returns identical bytes (cache invariant)", () => {
    const a = buildValidationSystemPrompt(baseSpec);
    const b = buildValidationSystemPrompt(baseSpec);
    expect(a).toBe(b);
  });

  it("inlines the grammar-point name, description, positive examples, and common errors verbatim", () => {
    const prompt = buildValidationSystemPrompt(baseSpec);
    expect(prompt).toContain(grammarPoint.name);
    expect(prompt).toContain(grammarPoint.description);
    for (const example of grammarPoint.examplesPositive) {
      expect(prompt).toContain(example);
    }
    for (const error of grammarPoint.commonErrors) {
      expect(prompt).toContain(error);
    }
  });

  it("interpolates language and CEFR level into the header and the dimension descriptions", () => {
    const prompt = buildValidationSystemPrompt(baseSpec);
    expect(prompt).toContain("ES learners at CEFR B1");
    expect(prompt).toContain("does the difficulty match B1?");
    expect(prompt).toContain(`does this actually test ${grammarPoint.name}?`);
  });

  it("shares CEFR descriptors with EVALUATION_SYSTEM_PROMPT (DRY invariant — Req 2.4)", () => {
    const b1Descriptor = CEFR_LEVEL_DESCRIPTORS[CefrLevel.B1];
    const validatorPrompt = buildValidationSystemPrompt(baseSpec);
    expect(validatorPrompt).toContain(b1Descriptor);
    expect(EVALUATION_SYSTEM_PROMPT).toContain(b1Descriptor);
  });

  it("contains the routing-implication block verbatim from plan §3.1", () => {
    const prompt = buildValidationSystemPrompt(baseSpec);
    // qualityScore < 0.5 OR cultural issue → REJECTED
    expect(prompt).toContain(
      "qualityScore < 0.5  OR  any cultural issue  → REJECTED",
    );
    // qualityScore in [0.5, 0.7) → FLAGGED
    expect(prompt).toContain("qualityScore in [0.5, 0.7)");
    expect(prompt).toContain("FLAGGED (waits for human review)");
    // qualityScore >= 0.7 conjunction → AUTO-APPROVED
    expect(prompt).toContain(
      "qualityScore >= 0.7 AND not ambiguous AND levelMatch AND grammarPointMatch",
    );
    expect(prompt).toContain("AUTO-APPROVED (visible to learners)");
    // Otherwise → FLAGGED catch-all
    expect(prompt).toContain("otherwise");
  });

  it("instructs Claude to use the submit_validation_result tool only", () => {
    const prompt = buildValidationSystemPrompt(baseSpec);
    expect(prompt).toContain("submit_validation_result");
    expect(prompt).toContain("Do not return plain text");
  });

  it("contains the strict-reviewer framing", () => {
    const prompt = buildValidationSystemPrompt(baseSpec);
    expect(prompt).toContain("strict reviewer");
    expect(prompt).toContain("Be conservative");
  });
});

// ---------------------------------------------------------------------------
// VALIDATION_SYSTEM_PROMPT_TEMPLATE
// ---------------------------------------------------------------------------

describe("VALIDATION_SYSTEM_PROMPT_TEMPLATE", () => {
  it("contains the placeholder tokens that buildValidationSystemPrompt interpolates", () => {
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain("{{language}}");
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain("{{cefrLevel}}");
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain("{{grammarPoint.name}}");
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain("{{CEFR_DESCRIPTORS}}");
  });
});

// ---------------------------------------------------------------------------
// buildValidationUserPrompt
// ---------------------------------------------------------------------------

describe("buildValidationUserPrompt", () => {
  it("renders a cloze draft with every documented field + Spec preamble", () => {
    const content: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "Fill in the blank with the present subjunctive.",
      sentence: "Espero que ___ a tiempo.",
      correctAnswer: "llegues",
      options: ["llegas", "llegues", "llegabas"],
      context: "Hopes and wishes",
    };
    const prompt = buildValidationUserPrompt(makeDraft(content), baseSpec);

    expect(prompt).toContain("Validate this Cloze exercise");
    expect(prompt).toContain(
      `**Spec:** language=${Language.ES}, cefrLevel=${CefrLevel.B1}, grammar point=${grammarPoint.key}`,
    );
    expect(prompt).toContain(
      "**Instructions:** Fill in the blank with the present subjunctive.",
    );
    expect(prompt).toContain("**Sentence:** Espero que ___ a tiempo.");
    expect(prompt).toContain("**Correct Answer:** llegues");
    expect(prompt).toContain("**Options:** llegas, llegues, llegabas");
    expect(prompt).toContain("**Context:** Hopes and wishes");
  });

  it("omits Options and Context lines for cloze drafts that lack them", () => {
    const content: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "x",
      sentence: "y ___ z",
      correctAnswer: "w",
    };
    const prompt = buildValidationUserPrompt(makeDraft(content), baseSpec);
    expect(prompt).not.toContain("**Options:**");
    expect(prompt).not.toContain("**Context:**");
  });

  it("renders a translation draft with every documented field + Spec preamble", () => {
    const content: TranslationContent = {
      type: ExerciseType.TRANSLATION,
      instructions: "Translate to Spanish.",
      sourceText: "I hope you arrive on time.",
      sourceLanguage: Language.EN,
      targetLanguage: Language.ES,
      referenceTranslation: "Espero que llegues a tiempo.",
    };
    const prompt = buildValidationUserPrompt(makeDraft(content), baseSpec);

    expect(prompt).toContain("Validate this Translation exercise");
    expect(prompt).toContain(
      `**Spec:** language=${Language.ES}, cefrLevel=${CefrLevel.B1}, grammar point=${grammarPoint.key}`,
    );
    expect(prompt).toContain("**Instructions:** Translate to Spanish.");
    expect(prompt).toContain(
      `**Source Text (${Language.EN}):** I hope you arrive on time.`,
    );
    expect(prompt).toContain(`**Target Language:** ${Language.ES}`);
    expect(prompt).toContain(
      "**Reference Translation:** Espero que llegues a tiempo.",
    );
  });

  it("renders a vocab_recall draft with every documented field + Spec preamble", () => {
    const content: VocabRecallContent = {
      type: ExerciseType.VOCAB_RECALL,
      instructions: "Provide the Spanish word.",
      prompt: "The mood used after expressions of doubt or wish.",
      expectedWord: "subjuntivo",
      hints: ["Starts with 's'", "9 letters"],
      exampleSentence: "El subjuntivo es importante.",
    };
    const prompt = buildValidationUserPrompt(makeDraft(content), baseSpec);

    expect(prompt).toContain("Validate this Vocabulary Recall exercise");
    expect(prompt).toContain(
      `**Spec:** language=${Language.ES}, cefrLevel=${CefrLevel.B1}, grammar point=${grammarPoint.key}`,
    );
    expect(prompt).toContain("**Instructions:** Provide the Spanish word.");
    expect(prompt).toContain(
      "**Prompt:** The mood used after expressions of doubt or wish.",
    );
    expect(prompt).toContain("**Expected Word:** subjuntivo");
    expect(prompt).toContain("**Hints:** Starts with 's'; 9 letters");
    expect(prompt).toContain("**Example Sentence:** El subjuntivo es importante.");
  });

  it("is deterministic — same (draft, spec) returns identical bytes", () => {
    const content: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "x",
      sentence: "a ___ b",
      correctAnswer: "c",
    };
    const draft = makeDraft(content);
    const a = buildValidationUserPrompt(draft, baseSpec);
    const b = buildValidationUserPrompt(draft, baseSpec);
    expect(a).toBe(b);
  });
});
