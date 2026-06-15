import { describe, expect, it } from "vitest";
import { CefrLevel, ExerciseType, Language, type GrammarPoint } from "@language-drill/shared";
import {
  FREE_WRITING_GENERATION_PROMPT_VERSION,
  FREE_WRITING_LENGTH_BY_CEFR,
  computeFreeWritingGenerationPromptVars,
  buildFreeWritingGenerationUserPrompt,
} from "./free-writing-generation-prompts.js";
import type { GenerationPromptInputs } from "./generation-prompts.js";

const TOPIC: GrammarPoint = {
  key: "es-b2-fw-remote-work",
  kind: "free-writing",
  name: "El teletrabajo: ¿avance o aislamiento?",
  description: "Opinion essay weighing the benefits and drawbacks of remote work.",
  cefrLevel: CefrLevel.B2,
  language: Language.ES,
  examplesPositive: ["Argues a clear thesis with two supporting reasons.", "Asks for a concession paragraph."],
  examplesNegative: ["*Write anything you want about work."],
  commonErrors: ["Prompt is too open to score."],
  freeWriting: { register: "formal" },
};

const INPUTS: GenerationPromptInputs = {
  language: Language.ES,
  cefrLevel: CefrLevel.B2,
  exerciseType: ExerciseType.FREE_WRITING,
  grammarPoint: TOPIC,
};

describe("free-writing generation prompt", () => {
  it("pins a dated version tag", () => {
    expect(FREE_WRITING_GENERATION_PROMPT_VERSION).toMatch(/^free-writing-generate@\d{4}-\d{2}-\d{2}$/);
  });

  it("derives the word band from the CEFR level", () => {
    expect(FREE_WRITING_LENGTH_BY_CEFR.B2).toEqual({ minWords: 150, maxWords: 200, suggestedMinutes: 25 });
  });

  it("injects topic, register and band into the prompt vars", () => {
    const vars = computeFreeWritingGenerationPromptVars(INPUTS);
    expect(vars.register).toBe("formal");
    expect(vars.minWords).toBe("150");
    expect(vars.maxWords).toBe("200");
    expect(vars.topicName).toBe(TOPIC.name);
    expect(vars.toolName).toBe("submit_free_writing_exercise");
  });

  it("throws when the cell is not a free-writing cell", () => {
    expect(() =>
      computeFreeWritingGenerationPromptVars({ ...INPUTS, exerciseType: ExerciseType.CLOZE }),
    ).toThrow(/non-free-writing/);
  });

  it("throws when the topic entry has no register", () => {
    const noReg = { ...INPUTS, grammarPoint: { ...TOPIC, freeWriting: undefined } };
    expect(() => computeFreeWritingGenerationPromptVars(noReg)).toThrow(/register/);
  });

  it("user prompt names the ordinal and asks for variety", () => {
    const p = buildFreeWritingGenerationUserPrompt(INPUTS, 2);
    expect(p).toContain("#3");
    expect(p).toContain("submit_free_writing_exercise");
  });
});
