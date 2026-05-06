import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CefrLevel,
  type ClozeContent,
  type ExerciseContent,
  ExerciseType,
  Language,
} from "@language-drill/shared";
import { getGrammarPoint } from "@language-drill/db";

import type { ExerciseDraft, GenerationSpec } from "./generate.js";
import { GENERATION_MODEL } from "./generate.js";
import {
  parseValidationResult,
  validateDraft,
  VALIDATION_MAX_TOKENS,
  VALIDATION_MODEL,
  VALIDATION_TEMPERATURE,
  VALIDATION_TOOL,
  VALIDATION_TOOL_NAME,
  type ValidationResult,
} from "./validate.js";

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

const clozeContent: ClozeContent = {
  type: ExerciseType.CLOZE,
  instructions: "Fill in the blank with the present subjunctive.",
  sentence: "Espero que ___ a tiempo.",
  correctAnswer: "llegues",
};

function makeDraft(content: ExerciseContent): ExerciseDraft {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    contentJson: content,
    metadata: {
      grammarPointKey: grammarPoint!.key,
      topicDomain: null,
      modelId: GENERATION_MODEL,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      inBatchDuplicate: false,
    },
  };
}

const validValidationInput: ValidationResult = {
  qualityScore: 0.85,
  ambiguous: false,
  levelMatch: true,
  grammarPointMatch: true,
  culturalIssues: [],
  flaggedReasons: [],
};

// ---------------------------------------------------------------------------
// Cross-file model invariant (Requirement 8.5)
// ---------------------------------------------------------------------------

describe("VALIDATION_MODEL", () => {
  it("matches GENERATION_MODEL (cross-file invariant)", () => {
    expect(VALIDATION_MODEL).toBe(GENERATION_MODEL);
  });

  it("matches the literal evaluator model pin (three-way invariant)", () => {
    // evaluate.test.ts:320 asserts the evaluator's call args use this exact
    // literal. Together with the GENERATION_MODEL assertion above, this pins
    // all three Claude paths (generator, validator, evaluator) to one model.
    expect(VALIDATION_MODEL).toBe("claude-sonnet-4-5");
  });
});

// ---------------------------------------------------------------------------
// VALIDATION_TOOL schema
// ---------------------------------------------------------------------------

describe("VALIDATION_TOOL", () => {
  it("has the correct tool name", () => {
    expect(VALIDATION_TOOL.name).toBe(VALIDATION_TOOL_NAME);
    expect(VALIDATION_TOOL_NAME).toBe("submit_validation_result");
  });

  it("declares all six required fields", () => {
    const required = (VALIDATION_TOOL.input_schema as { required: string[] })
      .required;
    expect(required).toContain("qualityScore");
    expect(required).toContain("ambiguous");
    expect(required).toContain("levelMatch");
    expect(required).toContain("grammarPointMatch");
    expect(required).toContain("culturalIssues");
    expect(required).toContain("flaggedReasons");
  });
});

// ---------------------------------------------------------------------------
// parseValidationResult
// ---------------------------------------------------------------------------

describe("parseValidationResult", () => {
  it("accepts a well-formed input and returns a typed ValidationResult", () => {
    const result = parseValidationResult(validValidationInput);
    expect(result).toEqual(validValidationInput);
  });

  it("throws when input is not an object", () => {
    expect(() => parseValidationResult(null)).toThrow(
      "Validation result must be an object",
    );
    expect(() => parseValidationResult("string")).toThrow(
      "Validation result must be an object",
    );
    expect(() => parseValidationResult(42)).toThrow(
      "Validation result must be an object",
    );
  });

  it("throws when qualityScore is not a number", () => {
    expect(() =>
      parseValidationResult({
        ...validValidationInput,
        qualityScore: "not a number",
      }),
    ).toThrow("Invalid qualityScore");
  });

  it("throws when qualityScore is below 0", () => {
    expect(() =>
      parseValidationResult({ ...validValidationInput, qualityScore: -0.1 }),
    ).toThrow("Invalid qualityScore");
  });

  it("throws when qualityScore is above 1", () => {
    expect(() =>
      parseValidationResult({ ...validValidationInput, qualityScore: 1.1 }),
    ).toThrow("Invalid qualityScore");
  });

  it("throws when ambiguous is not a boolean", () => {
    expect(() =>
      parseValidationResult({ ...validValidationInput, ambiguous: "yes" }),
    ).toThrow("Invalid ambiguous");
  });

  it("throws when levelMatch is not a boolean", () => {
    expect(() =>
      parseValidationResult({ ...validValidationInput, levelMatch: 1 }),
    ).toThrow("Invalid levelMatch");
  });

  it("throws when grammarPointMatch is not a boolean", () => {
    expect(() =>
      parseValidationResult({
        ...validValidationInput,
        grammarPointMatch: null,
      }),
    ).toThrow("Invalid grammarPointMatch");
  });

  it("throws when culturalIssues is not an array", () => {
    expect(() =>
      parseValidationResult({
        ...validValidationInput,
        culturalIssues: "stereotyping",
      }),
    ).toThrow("Invalid culturalIssues");
  });

  it("throws when culturalIssues contains a non-string element", () => {
    expect(() =>
      parseValidationResult({
        ...validValidationInput,
        culturalIssues: ["valid", 42],
      }),
    ).toThrow("Invalid culturalIssues[1]");
  });

  it("throws when flaggedReasons is not an array", () => {
    expect(() =>
      parseValidationResult({
        ...validValidationInput,
        flaggedReasons: { notAnArray: true },
      }),
    ).toThrow("Invalid flaggedReasons");
  });

  it("throws when a required field is missing", () => {
    const { qualityScore: _omit, ...partial } = validValidationInput;
    expect(() => parseValidationResult(partial)).toThrow("Invalid qualityScore");
  });
});

// ---------------------------------------------------------------------------
// validateDraft (mocked SDK)
// ---------------------------------------------------------------------------

describe("validateDraft", () => {
  const mockCreate = vi.fn();
  const mockClient = {
    messages: { create: mockCreate },
  } as unknown as Parameters<typeof validateDraft>[0];

  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("calls Claude with the right params and returns the parsed result + tokenUsage", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_v_1",
          name: VALIDATION_TOOL_NAME,
          input: validValidationInput,
        },
      ],
      stop_reason: "tool_use",
      usage: {
        input_tokens: 1000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 200,
      },
    });

    const { result, tokenUsage } = await validateDraft(
      mockClient,
      makeDraft(clozeContent),
      baseSpec,
    );

    expect(result).toEqual(validValidationInput);
    expect(tokenUsage).toEqual({
      inputTokens: 1000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 200,
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe(VALIDATION_MODEL);
    expect(callArgs.temperature).toBe(VALIDATION_TEMPERATURE);
    expect(callArgs.max_tokens).toBe(VALIDATION_MAX_TOKENS);
    expect(callArgs.tools).toEqual([VALIDATION_TOOL]);
    expect(callArgs.tool_choice).toEqual({
      type: "tool",
      name: VALIDATION_TOOL_NAME,
    });
    // The system block is cached for prompt-cache hits within a cell.
    expect(callArgs.system).toHaveLength(1);
    expect(callArgs.system[0].type).toBe("text");
    expect(callArgs.system[0].cache_control).toEqual({ type: "ephemeral" });
    // The user message carries the rendered draft.
    expect(callArgs.messages).toHaveLength(1);
    expect(callArgs.messages[0].role).toBe("user");
    expect(callArgs.messages[0].content).toContain(
      "Validate this Cloze exercise",
    );
  });

  it("defaults missing usage fields to 0", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_v_2",
          name: VALIDATION_TOOL_NAME,
          input: validValidationInput,
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 500, output_tokens: 100 },
    });

    const { tokenUsage } = await validateDraft(
      mockClient,
      makeDraft(clozeContent),
      baseSpec,
    );
    expect(tokenUsage).toEqual({
      inputTokens: 500,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 100,
    });
  });

  it("throws when Claude returns no tool_use block", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "I cannot validate this." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 10 },
    });

    await expect(
      validateDraft(mockClient, makeDraft(clozeContent), baseSpec),
    ).rejects.toThrow(/Validator did not return a tool use block.*Stop reason: end_turn/);
  });

  it("throws when Claude returns the wrong tool name", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_v_wrong",
          name: "wrong_tool",
          input: validValidationInput,
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 10 },
    });

    await expect(
      validateDraft(mockClient, makeDraft(clozeContent), baseSpec),
    ).rejects.toThrow(/Unexpected tool name.*wrong_tool/);
  });

  it("re-raises parser errors with field-level message", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_v_bad",
          name: VALIDATION_TOOL_NAME,
          input: { ...validValidationInput, qualityScore: 1.5 },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 10 },
    });

    await expect(
      validateDraft(mockClient, makeDraft(clozeContent), baseSpec),
    ).rejects.toThrow("Invalid qualityScore");
  });

  it("throws BEFORE calling Claude when draft.contentJson.type is unsupported (Req 1.8)", async () => {
    const draft: ExerciseDraft = {
      ...makeDraft(clozeContent),
      // Force an unsupported type — cast through unknown so TS lets us model
      // a malformed draft a future caller might construct.
      contentJson: {
        ...clozeContent,
        type: "unknown",
      } as unknown as ExerciseContent,
    };

    await expect(validateDraft(mockClient, draft, baseSpec)).rejects.toThrow(
      "Unsupported draft.contentJson.type: unknown",
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("guard reads from draft, not spec — fires even when spec.exerciseType is valid", async () => {
    // spec has the correct cloze type; only the draft is malformed.
    const draft: ExerciseDraft = {
      ...makeDraft(clozeContent),
      contentJson: {
        ...clozeContent,
        type: "unknown",
      } as unknown as ExerciseContent,
    };
    expect(baseSpec.exerciseType).toBe(ExerciseType.CLOZE);

    await expect(validateDraft(mockClient, draft, baseSpec)).rejects.toThrow(
      "Unsupported draft.contentJson.type: unknown",
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("does not mutate draft or spec inputs", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_v_immut",
          name: VALIDATION_TOOL_NAME,
          input: validValidationInput,
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 10 },
    });

    const draft = makeDraft(clozeContent);
    const draftBefore = structuredClone(draft);
    const specBefore = structuredClone(baseSpec);

    await validateDraft(mockClient, draft, baseSpec);

    expect(draft).toEqual(draftBefore);
    expect(baseSpec).toEqual(specBefore);
  });
});
