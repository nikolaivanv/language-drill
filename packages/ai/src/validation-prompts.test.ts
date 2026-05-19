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
  computeValidationPromptVars,
  VALIDATION_SYSTEM_PROMPT_TEMPLATE,
} from "./validation-prompts.js";
import { applyTemplate } from "./prompts-registry.js";

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
  it("is deterministic — same spec returns identical bytes (cache invariant)", async () => {
    // Async since Phase-2: must await both before comparing, otherwise
    // `toBe` compares two distinct Promise references and fails trivially.
    const [a, b] = await Promise.all([
      buildValidationSystemPrompt(baseSpec),
      buildValidationSystemPrompt(baseSpec),
    ]);
    expect(a).toBe(b);
  });

  it("inlines the grammar-point name, description, positive examples, and common errors verbatim", async () => {
    const prompt = await buildValidationSystemPrompt(baseSpec);
    expect(prompt).toContain(grammarPoint.name);
    expect(prompt).toContain(grammarPoint.description);
    for (const example of grammarPoint.examplesPositive) {
      expect(prompt).toContain(example);
    }
    for (const error of grammarPoint.commonErrors) {
      expect(prompt).toContain(error);
    }
  });

  it("interpolates language and CEFR level into the header and the dimension descriptions", async () => {
    const prompt = await buildValidationSystemPrompt(baseSpec);
    expect(prompt).toContain("ES learners at CEFR B1");
    expect(prompt).toContain("does the difficulty match B1?");
    expect(prompt).toContain(`does this actually test ${grammarPoint.name}?`);
  });

  it("shares CEFR descriptors with EVALUATION_SYSTEM_PROMPT (DRY invariant — Req 2.4)", async () => {
    const b1Descriptor = CEFR_LEVEL_DESCRIPTORS[CefrLevel.B1];
    const validatorPrompt = await buildValidationSystemPrompt(baseSpec);
    expect(validatorPrompt).toContain(b1Descriptor);
    expect(EVALUATION_SYSTEM_PROMPT).toContain(b1Descriptor);
  });

  it("contains the routing-implication block verbatim from plan §3.1", async () => {
    const prompt = await buildValidationSystemPrompt(baseSpec);
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

  it("instructs Claude to use the submit_validation_result tool only", async () => {
    const prompt = await buildValidationSystemPrompt(baseSpec);
    expect(prompt).toContain("submit_validation_result");
    expect(prompt).toContain("Do not return plain text");
  });

  it("contains the strict-reviewer framing", async () => {
    const prompt = await buildValidationSystemPrompt(baseSpec);
    expect(prompt).toContain("strict reviewer");
    expect(prompt).toContain("Be conservative");
  });
});

// ---------------------------------------------------------------------------
// VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity (Phase 2, Task 12)
// ---------------------------------------------------------------------------

/**
 * Pins the contract: `applyTemplate(TEMPLATE, computeVars(spec)).text`
 * MUST equal `buildValidationSystemPrompt(spec)` byte-for-byte. The
 * pre-Phase-2 template used nested-path placeholders (`{{grammarPoint.
 * name}}`, `{{CEFR_DESCRIPTORS}}`) that the Mustache subset doesn't
 * resolve to anything; this block proves the rewritten flat-string
 * template is a true drop-in for the live builder before Task 13
 * routes both through `getPromptWithVarsOrFallback`.
 *
 * Why this matters: Anthropic's ephemeral prompt cache requires
 * byte-identical system blocks across validator calls within the
 * 5-min window. Drift between the template and the in-code builder
 * silently breaks the cache and inflates validation cost.
 */
describe("VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity", () => {
  async function assertParity(spec: GenerationSpec): Promise<void> {
    // Builder is now async (Phase-2, Task 13). Fallback path (Langfuse
    // keys unset in CI) returns the template-substituted string, so
    // byte parity vs. local `applyTemplate(TEMPLATE, vars)` still holds.
    const builderOutput = await buildValidationSystemPrompt(spec);
    const templateOutput = applyTemplate(
      VALIDATION_SYSTEM_PROMPT_TEMPLATE,
      computeValidationPromptVars(spec),
    );
    expect(templateOutput.missingVars).toEqual([]);
    expect(templateOutput.text).toBe(builderOutput);
  }

  it("ES / B1 / cloze / es-b1-present-subjunctive (base fixture)", async () => {
    await assertParity(baseSpec);
  });

  it("survives a different language + level combination (cache parity across specs)", async () => {
    // Turkish A1 vowel-harmony is in the live curriculum and uses a
    // distinct example/error vocabulary, exercising the
    // `positiveExamplesBullets`/`commonErrorsBullets` substitution paths
    // with content separate from the base fixture.
    const altGrammarPoint = getGrammarPoint("tr-a1-vowel-harmony");
    if (!altGrammarPoint) {
      throw new Error(
        "test fixture missing: curriculum entry 'tr-a1-vowel-harmony'",
      );
    }
    await assertParity({
      ...baseSpec,
      language: Language.TR,
      cefrLevel: CefrLevel.A1,
      grammarPoint: altGrammarPoint,
    });
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
