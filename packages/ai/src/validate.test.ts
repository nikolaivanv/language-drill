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
  ValidationParseError,
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
  contextSpoilsAnswer: false,
  levelMatch: true,
  grammarPointMatch: true,
  culturalIssues: [],
  flaggedReasons: [],
  coverage: {},
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
    expect(VALIDATION_MODEL).toBe("claude-sonnet-4-6");
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

  it("declares all required fields", () => {
    const required = (VALIDATION_TOOL.input_schema as { required: string[] })
      .required;
    expect(required).toContain("qualityScore");
    expect(required).toContain("ambiguous");
    expect(required).toContain("contextSpoilsAnswer");
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

  it("throws ValidationParseError when input is not an object", () => {
    for (const bad of [null, "string", 42]) {
      expect(() => parseValidationResult(bad)).toThrow(ValidationParseError);
      expect(() => parseValidationResult(bad)).toThrow(
        "Validation result must be an object",
      );
    }
  });

  it("throws ValidationParseError when qualityScore is not a number", () => {
    expect(() =>
      parseValidationResult({
        ...validValidationInput,
        qualityScore: "not a number",
      }),
    ).toThrow(ValidationParseError);
    expect(() =>
      parseValidationResult({
        ...validValidationInput,
        qualityScore: "not a number",
      }),
    ).toThrow("Invalid qualityScore");
  });

  it("throws ValidationParseError when qualityScore is below 0", () => {
    expect(() =>
      parseValidationResult({ ...validValidationInput, qualityScore: -0.1 }),
    ).toThrow(ValidationParseError);
  });

  it("throws ValidationParseError when qualityScore is above 1", () => {
    expect(() =>
      parseValidationResult({ ...validValidationInput, qualityScore: 1.1 }),
    ).toThrow(ValidationParseError);
  });

  it("throws ValidationParseError when ambiguous is not a boolean", () => {
    expect(() =>
      parseValidationResult({ ...validValidationInput, ambiguous: "yes" }),
    ).toThrow(ValidationParseError);
    expect(() =>
      parseValidationResult({ ...validValidationInput, ambiguous: "yes" }),
    ).toThrow("Invalid ambiguous");
  });

  it("throws ValidationParseError when levelMatch is not a boolean", () => {
    expect(() =>
      parseValidationResult({ ...validValidationInput, levelMatch: 1 }),
    ).toThrow(ValidationParseError);
  });

  it("throws ValidationParseError when grammarPointMatch is not a boolean", () => {
    expect(() =>
      parseValidationResult({
        ...validValidationInput,
        grammarPointMatch: null,
      }),
    ).toThrow(ValidationParseError);
  });

  // --- R8 leniency: the two reason arrays are non-load-bearing ------------

  it("coerces a non-array culturalIssues to [] instead of throwing", () => {
    const result = parseValidationResult({
      ...validValidationInput,
      culturalIssues: "stereotyping",
    });
    expect(result.culturalIssues).toEqual([]);
  });

  it("drops non-string elements from culturalIssues", () => {
    const result = parseValidationResult({
      ...validValidationInput,
      culturalIssues: ["valid", 42, "also valid"],
    });
    expect(result.culturalIssues).toEqual(["valid", "also valid"]);
  });

  it("coerces a non-array flaggedReasons to [] instead of throwing", () => {
    const result = parseValidationResult({
      ...validValidationInput,
      flaggedReasons: { notAnArray: true },
    });
    expect(result.flaggedReasons).toEqual([]);
  });

  it("coerces a missing flaggedReasons to [] (the 2026-05-24 failure)", () => {
    // Reproduces `Invalid flaggedReasons: must be an array, got undefined`
    // — now a no-op, not a cell-killing throw.
    const { flaggedReasons: _omit, ...withoutFlagged } = validValidationInput;
    const result = parseValidationResult(withoutFlagged);
    expect(result.flaggedReasons).toEqual([]);
    // The rest of the result is intact.
    expect(result.qualityScore).toBe(validValidationInput.qualityScore);
  });

  it("coerces a missing culturalIssues to []", () => {
    const { culturalIssues: _omit, ...withoutCultural } = validValidationInput;
    const result = parseValidationResult(withoutCultural);
    expect(result.culturalIssues).toEqual([]);
  });

  it("throws ValidationParseError when a load-bearing field is missing", () => {
    const { qualityScore: _omit, ...partial } = validValidationInput;
    expect(() => parseValidationResult(partial)).toThrow(ValidationParseError);
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

  it("uses the dictation validation prompt for a dictation draft", async () => {
    let capturedSystem: string | undefined;
    mockCreate.mockImplementation(async (req: { system: { text: string }[] }) => {
      capturedSystem = req.system[0].text;
      return {
        content: [
          {
            type: "tool_use",
            id: "toolu_v_dict",
            name: VALIDATION_TOOL_NAME,
            input: validValidationInput,
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 5, output_tokens: 5 },
      };
    });

    const dictationDraft = {
      ...makeDraft(clozeContent),
      contentJson: {
        type: ExerciseType.DICTATION,
        title: "El tiempo",
        referenceText: "El tiempo lo cura.",
        sentences: ["El tiempo lo cura."],
        accent: "a",
        voiceId: "Sergio",
        tested: ["sinalefa"],
        durationSec: 6,
        waveform: [0.5],
      } as unknown as ExerciseContent,
    };
    const dictationSpec: GenerationSpec = {
      ...baseSpec,
      exerciseType: ExerciseType.DICTATION,
    };

    const { result } = await validateDraft(
      mockClient,
      dictationDraft,
      dictationSpec,
    );

    expect(result.qualityScore).toBe(0.85);
    // The dictation system prompt is used, not the cloze one.
    expect(capturedSystem).toContain("dictation");
    // A cloze-only phrase from VALIDATION_SYSTEM_PROMPT_TEMPLATE — absent from
    // the dictation system prompt, so this guards against prompt cross-contamination.
    expect(capturedSystem).not.toContain("buffer-consonant ambiguous blank");
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

  it("routes a free-writing draft to the free-writing validation prompt", async () => {
    let capturedSystem = "";
    const fakeClient = {
      messages: {
        create: async (params: { system: { text: string }[] }) => {
          capturedSystem = params.system[0].text;
          return {
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                name: VALIDATION_TOOL_NAME,
                id: "toolu_fw_test",
                input: {
                  qualityScore: 0.9,
                  ambiguous: false,
                  contextSpoilsAnswer: false,
                  levelMatch: true,
                  grammarPointMatch: true,
                  culturalIssues: [],
                  flaggedReasons: [],
                },
              },
            ],
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    };

    const fwContent = {
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
    const draft = {
      id: "00000000-0000-0000-0000-000000000000",
      contentJson: fwContent,
      metadata: {
        grammarPointKey: "es-b2-fw-remote-work",
        topicDomain: null,
        modelId: "claude-sonnet-4-6",
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        inBatchDuplicate: false,
      },
    };
    const spec = {
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

    const result = await validateDraft(fakeClient as never, draft as never, spec as never);
    expect(capturedSystem).toContain("free-writing PROMPTS");
    expect(result.result.qualityScore).toBe(0.9);
  });
});

// ---------------------------------------------------------------------------
// parseValidationResult — coverage
// ---------------------------------------------------------------------------

describe("parseValidationResult — coverage", () => {
  const base = {
    qualityScore: 0.9,
    ambiguous: false,
    contextSpoilsAnswer: false,
    levelMatch: true,
    grammarPointMatch: true,
    culturalIssues: [],
    flaggedReasons: [],
  };

  it("keeps valid axis values", () => {
    const r = parseValidationResult({
      ...base,
      coverage: { person: "2pl", polarity: "negative" },
    });
    expect(r.coverage).toEqual({ person: "2pl", polarity: "negative" });
  });

  it("drops values not in the axis enum", () => {
    const r = parseValidationResult({
      ...base,
      coverage: { person: "4sg", wordClass: "noun", bogus: "x" },
    });
    expect(r.coverage).toEqual({ wordClass: "noun" });
  });

  it("missing or non-object coverage → empty object", () => {
    expect(parseValidationResult(base).coverage).toEqual({});
    expect(
      parseValidationResult({ ...base, coverage: "nope" }).coverage,
    ).toEqual({});
  });

  it("a malformed coverage never affects routing fields", () => {
    const r = parseValidationResult({ ...base, coverage: 42 });
    expect(r.qualityScore).toBe(0.9);
    expect(r.grammarPointMatch).toBe(true);
  });
});
