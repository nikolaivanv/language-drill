import { describe, expect, it } from "vitest";
import { CefrLevel, ExerciseType, Language, type GrammarPoint } from "@language-drill/shared";
import {
  FREE_WRITING_GENERATION_PROMPT_VERSION,
  FREE_WRITING_LENGTH_BY_CEFR,
  CONCRETE_FREE_WRITING_ANGLES,
  FULL_FREE_WRITING_ANGLES,
  computeFreeWritingGenerationPromptVars,
  buildFreeWritingGenerationUserPrompt,
  freeWritingAngleForOrdinal,
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
    expect(FREE_WRITING_LENGTH_BY_CEFR.A1).toEqual({ minWords: 30, maxWords: 60, suggestedMinutes: 10 });
    expect(FREE_WRITING_LENGTH_BY_CEFR.A2).toEqual({ minWords: 60, maxWords: 100, suggestedMinutes: 15 });
    expect(FREE_WRITING_LENGTH_BY_CEFR.B1).toEqual({ minWords: 80, maxWords: 120, suggestedMinutes: 15 });
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

  it("omits the prior-titles section when there are no prior titles", () => {
    expect(computeFreeWritingGenerationPromptVars(INPUTS).priorTitlesSection).toBe("");
  });

  it("renders prior titles as an avoid-list when present", () => {
    const vars = computeFreeWritingGenerationPromptVars({
      ...INPUTS,
      priorPoolSurfaces: ["el teletrabajo: ¿avance o aislamiento?", "teletrabajo y soledad"],
    });
    expect(vars.priorTitlesSection).toContain("do NOT reuse");
    expect(vars.priorTitlesSection).toContain("teletrabajo y soledad");
  });

  it("rotates B1/B2 ordinals through the full analytical angle pool", () => {
    // INPUTS is B2 → full pool. Each ordinal in a batch < pool length is unique.
    const seen = new Set(
      Array.from({ length: FULL_FREE_WRITING_ANGLES.length }, (_, i) =>
        freeWritingAngleForOrdinal(i, "B2"),
      ),
    );
    expect(seen.size).toBe(FULL_FREE_WRITING_ANGLES.length);
    expect(freeWritingAngleForOrdinal(FULL_FREE_WRITING_ANGLES.length, "B2")).toBe(
      FULL_FREE_WRITING_ANGLES[0],
    );
    const p = buildFreeWritingGenerationUserPrompt(INPUTS, 0);
    expect(p).toContain(FULL_FREE_WRITING_ANGLES[0]);
    expect(p).toMatch(/do NOT reuse the bare topic name/i);
  });

  it("rotates A1/A2 ordinals through the concrete (non-analytical) angle pool", () => {
    // A1/A2 must avoid argumentative angles (opposing positions, recommendation).
    const a1Inputs = { ...INPUTS, cefrLevel: CefrLevel.A1 };
    const angle = freeWritingAngleForOrdinal(0, "A1");
    expect(CONCRETE_FREE_WRITING_ANGLES).toContain(angle);
    // The concrete pool must exclude argumentative angles that are too hard at A1/A2.
    expect(CONCRETE_FREE_WRITING_ANGLES).not.toContain("weighing two clearly opposing positions");
    const p = buildFreeWritingGenerationUserPrompt(a1Inputs, 0);
    expect(p).toContain(CONCRETE_FREE_WRITING_ANGLES[0]);
  });
});
