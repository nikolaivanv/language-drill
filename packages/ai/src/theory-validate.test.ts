import { beforeEach, describe, expect, it, vi } from "vitest";

import { esCurriculum } from "@language-drill/db";
import { Language, type TheoryTopicJson } from "@language-drill/shared";

import { GENERATION_MODEL } from "./generate.js";
import type { TheoryDraft, TheoryGenerationSpec } from "./theory-generate.js";
import {
  parseTheoryValidationResult,
  validateTheoryDraft,
  THEORY_VALIDATION_MAX_TOKENS,
  THEORY_VALIDATION_MODEL,
  THEORY_VALIDATION_TEMPERATURE,
  THEORY_VALIDATION_TOOL,
  THEORY_VALIDATION_TOOL_NAME,
  type TheoryValidationResult,
} from "./theory-validate.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const grammarEntry = esCurriculum.find((e) => e.kind === "grammar");
if (!grammarEntry) {
  throw new Error(
    "test fixture missing: no `kind: 'grammar'` entry in esCurriculum",
  );
}

const baseSpec: TheoryGenerationSpec = {
  language: Language.ES,
  cefrLevel: grammarEntry.cefrLevel,
  grammarPoint: grammarEntry,
  batchSeed: "test-seed",
};

const minimalTopic: TheoryTopicJson = {
  id: "b1-test",
  title: "Test Topic",
  subtitle: "A minimal page for validator tests",
  cefr: "B1",
  sections: [
    {
      id: "what-is-it",
      title: "what is it?",
      body: [
        {
          kind: "paragraph",
          text: [{ kind: "text", text: "Definition." }],
        },
      ],
    },
  ],
};

function makeDraft(content: TheoryTopicJson = minimalTopic): TheoryDraft {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    topicId: "b1-test",
    contentJson: content,
    metadata: {
      grammarPointKey: grammarEntry!.key,
      modelId: GENERATION_MODEL,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
  };
}

const validValidationInput: TheoryValidationResult = {
  qualityScore: 0.85,
  factualErrors: [],
  levelMismatch: false,
  sectionsIncomplete: [],
  examplesUseGrammarPoint: true,
  culturalIssues: [],
  flaggedReasons: [],
};

// ---------------------------------------------------------------------------
// Cross-file model invariant (Req 1.6)
// ---------------------------------------------------------------------------

describe("THEORY_VALIDATION_MODEL", () => {
  it("matches GENERATION_MODEL (cross-file invariant, Req 1.6)", () => {
    expect(THEORY_VALIDATION_MODEL).toBe(GENERATION_MODEL);
  });

  it("matches the literal model pin (three-way invariant)", () => {
    // Together with the GENERATION_MODEL assertion above, this pins the
    // generator, the exercise validator (validate.test.ts:91), and the
    // theory validator to a single Sonnet revision.
    expect(THEORY_VALIDATION_MODEL).toBe("claude-sonnet-4-6");
  });
});

// ---------------------------------------------------------------------------
// THEORY_VALIDATION_TOOL schema (Req 1.5)
// ---------------------------------------------------------------------------

describe("THEORY_VALIDATION_TOOL", () => {
  it("has the correct tool name", () => {
    expect(THEORY_VALIDATION_TOOL.name).toBe(THEORY_VALIDATION_TOOL_NAME);
    expect(THEORY_VALIDATION_TOOL_NAME).toBe("submit_theory_validation_result");
  });

  it("declares all seven required fields", () => {
    const required = (
      THEORY_VALIDATION_TOOL.input_schema as { required: string[] }
    ).required;
    expect(required).toContain("qualityScore");
    expect(required).toContain("factualErrors");
    expect(required).toContain("levelMismatch");
    expect(required).toContain("sectionsIncomplete");
    expect(required).toContain("examplesUseGrammarPoint");
    expect(required).toContain("culturalIssues");
    expect(required).toContain("flaggedReasons");
  });

  it("does not declare the exercise-validator-only fields", () => {
    // The two dropped dimensions are intentional per design Component 1.
    const required = (
      THEORY_VALIDATION_TOOL.input_schema as { required: string[] }
    ).required;
    expect(required).not.toContain("ambiguous");
    expect(required).not.toContain("grammarPointMatch");
    expect(required).not.toContain("levelMatch");
  });
});

// ---------------------------------------------------------------------------
// parseTheoryValidationResult (Req 1.4)
// ---------------------------------------------------------------------------

describe("parseTheoryValidationResult", () => {
  it("accepts a well-formed input and returns a typed TheoryValidationResult", () => {
    const result = parseTheoryValidationResult(validValidationInput);
    expect(result).toEqual(validValidationInput);
  });

  it("throws when input is not an object", () => {
    expect(() => parseTheoryValidationResult(null)).toThrow(
      "Theory validation result must be an object",
    );
    expect(() => parseTheoryValidationResult("string")).toThrow(
      "Theory validation result must be an object",
    );
    expect(() => parseTheoryValidationResult(42)).toThrow(
      "Theory validation result must be an object",
    );
  });

  it("throws when qualityScore is not a number", () => {
    expect(() =>
      parseTheoryValidationResult({
        ...validValidationInput,
        qualityScore: "not a number",
      }),
    ).toThrow("Invalid qualityScore");
  });

  it("throws when qualityScore is below 0", () => {
    expect(() =>
      parseTheoryValidationResult({
        ...validValidationInput,
        qualityScore: -0.1,
      }),
    ).toThrow("Invalid qualityScore");
  });

  it("throws when qualityScore is above 1", () => {
    expect(() =>
      parseTheoryValidationResult({
        ...validValidationInput,
        qualityScore: 1.1,
      }),
    ).toThrow("Invalid qualityScore");
  });

  it("throws when levelMismatch is not a boolean", () => {
    expect(() =>
      parseTheoryValidationResult({
        ...validValidationInput,
        levelMismatch: "yes",
      }),
    ).toThrow("Invalid levelMismatch");
  });

  it("throws when examplesUseGrammarPoint is not a boolean", () => {
    expect(() =>
      parseTheoryValidationResult({
        ...validValidationInput,
        examplesUseGrammarPoint: 1,
      }),
    ).toThrow("Invalid examplesUseGrammarPoint");
  });

  it("throws when factualErrors is not an array", () => {
    expect(() =>
      parseTheoryValidationResult({
        ...validValidationInput,
        factualErrors: "wrong rule",
      }),
    ).toThrow("Invalid factualErrors");
  });

  it("throws when factualErrors contains a non-string element", () => {
    expect(() =>
      parseTheoryValidationResult({
        ...validValidationInput,
        factualErrors: ["valid", 42],
      }),
    ).toThrow("Invalid factualErrors[1]");
  });

  it("throws when sectionsIncomplete is not an array", () => {
    expect(() =>
      parseTheoryValidationResult({
        ...validValidationInput,
        sectionsIncomplete: { notAnArray: true },
      }),
    ).toThrow("Invalid sectionsIncomplete");
  });

  it("throws when culturalIssues contains a non-string element", () => {
    expect(() =>
      parseTheoryValidationResult({
        ...validValidationInput,
        culturalIssues: ["valid", 42],
      }),
    ).toThrow("Invalid culturalIssues[1]");
  });

  it("throws when flaggedReasons is not an array", () => {
    expect(() =>
      parseTheoryValidationResult({
        ...validValidationInput,
        flaggedReasons: null,
      }),
    ).toThrow("Invalid flaggedReasons");
  });

  it("throws when a required field is missing", () => {
    const { qualityScore: _omit, ...partial } = validValidationInput;
    expect(() => parseTheoryValidationResult(partial)).toThrow(
      "Invalid qualityScore",
    );
  });
});

// ---------------------------------------------------------------------------
// validateTheoryDraft (mocked SDK) — Req 1.1, 1.2, 1.3, 1.4
// ---------------------------------------------------------------------------

describe("validateTheoryDraft", () => {
  const mockCreate = vi.fn();
  const mockClient = {
    messages: { create: mockCreate },
  } as unknown as Parameters<typeof validateTheoryDraft>[0];

  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("calls Claude with the right params and returns the parsed result + tokenUsage", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_tv_1",
          name: THEORY_VALIDATION_TOOL_NAME,
          input: validValidationInput,
        },
      ],
      stop_reason: "tool_use",
      usage: {
        input_tokens: 4000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 200,
      },
    });

    const { result, tokenUsage } = await validateTheoryDraft(
      mockClient,
      makeDraft(),
      baseSpec,
    );

    expect(result).toEqual(validValidationInput);
    expect(tokenUsage).toEqual({
      inputTokens: 4000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 200,
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe(THEORY_VALIDATION_MODEL);
    expect(callArgs.temperature).toBe(THEORY_VALIDATION_TEMPERATURE);
    expect(callArgs.max_tokens).toBe(THEORY_VALIDATION_MAX_TOKENS);
    expect(callArgs.tools).toEqual([THEORY_VALIDATION_TOOL]);
    expect(callArgs.tool_choice).toEqual({
      type: "tool",
      name: THEORY_VALIDATION_TOOL_NAME,
    });
    // Req 1.2: the system block carries cache_control: ephemeral.
    expect(callArgs.system).toHaveLength(1);
    expect(callArgs.system[0].type).toBe("text");
    expect(callArgs.system[0].cache_control).toEqual({ type: "ephemeral" });
    // The user message carries the rendered draft.
    expect(callArgs.messages).toHaveLength(1);
    expect(callArgs.messages[0].role).toBe("user");
    expect(callArgs.messages[0].content).toContain(grammarEntry.key);
  });

  it("defaults missing usage fields to 0", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_tv_2",
          name: THEORY_VALIDATION_TOOL_NAME,
          input: validValidationInput,
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 500, output_tokens: 100 },
    });

    const { tokenUsage } = await validateTheoryDraft(
      mockClient,
      makeDraft(),
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
      validateTheoryDraft(mockClient, makeDraft(), baseSpec),
    ).rejects.toThrow(
      /Validator did not return a tool use block.*Stop reason: end_turn/,
    );
  });

  it("throws when Claude returns the wrong tool name", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_tv_wrong",
          name: "wrong_tool",
          input: validValidationInput,
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 10 },
    });

    await expect(
      validateTheoryDraft(mockClient, makeDraft(), baseSpec),
    ).rejects.toThrow(/Unexpected tool name.*wrong_tool/);
  });

  it("re-raises parser errors with field-level message", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_tv_bad",
          name: THEORY_VALIDATION_TOOL_NAME,
          input: { ...validValidationInput, qualityScore: 1.5 },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 10 },
    });

    await expect(
      validateTheoryDraft(mockClient, makeDraft(), baseSpec),
    ).rejects.toThrow("Invalid qualityScore");
  });

  it("does not mutate draft or spec inputs", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_tv_immut",
          name: THEORY_VALIDATION_TOOL_NAME,
          input: validValidationInput,
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 10 },
    });

    const draft = makeDraft();
    const draftBefore = structuredClone(draft);
    const specBefore = structuredClone(baseSpec);

    await validateTheoryDraft(mockClient, draft, baseSpec);

    expect(draft).toEqual(draftBefore);
    expect(baseSpec).toEqual(specBefore);
  });
});
