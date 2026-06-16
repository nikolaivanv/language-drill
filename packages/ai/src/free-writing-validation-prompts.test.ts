import { describe, expect, it } from "vitest";
import { CefrLevel, ExerciseType, Language, type FreeWritingContent } from "@language-drill/shared";
import {
  FREE_WRITING_GENERATION_VALIDATION_PROMPT_VERSION,
  computeFreeWritingValidationPromptVars,
  buildFreeWritingValidationUserPrompt,
} from "./free-writing-validation-prompts.js";
import type { GenerationSpec } from "./generate.js";

const spec: GenerationSpec = {
  language: Language.ES,
  cefrLevel: CefrLevel.B2,
  exerciseType: ExerciseType.FREE_WRITING,
  grammarPoint: {
    key: "es-b2-fw-remote-work",
    kind: "free-writing",
    name: "El teletrabajo",
    description: "Opinion essay.",
    cefrLevel: CefrLevel.B2,
    language: Language.ES,
    examplesPositive: ["a", "b"],
    examplesNegative: ["*c"],
    commonErrors: ["d"],
    freeWriting: { register: "formal" },
  },
  topicDomain: null,
  count: 1,
  batchSeed: "t",
};

const content: FreeWritingContent = {
  type: ExerciseType.FREE_WRITING,
  instructions: "Escribe un párrafo.",
  title: "El teletrabajo",
  task: "Da tu opinión.",
  domain: "opinión",
  register: "formal",
  minWords: 150,
  maxWords: 200,
  suggestedMinutes: 25,
  requiredElements: [{ id: "thesis", label: "Expón tu opinión." }],
};

describe("free-writing validation prompt", () => {
  it("pins a dated version tag", () => {
    expect(FREE_WRITING_GENERATION_VALIDATION_PROMPT_VERSION).toMatch(
      /^free-writing-validate@\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("system vars carry language + level", () => {
    const vars = computeFreeWritingValidationPromptVars(spec);
    expect(vars.language).toBe("ES");
    expect(vars.cefrLevel).toBe("B2");
  });

  it("user prompt states the expected register and band + fixed-field reminder", () => {
    const p = buildFreeWritingValidationUserPrompt(content, spec);
    expect(p).toContain("formal");
    expect(p).toContain("150");
    expect(p).toContain("200");
    expect(p).toContain("grammarPointMatch=true");
  });
});
