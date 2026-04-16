import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  Language,
  CefrLevel,
  ExerciseType,
} from "@language-drill/shared";
import type {
  ClozeContent,
  TranslationContent,
  VocabRecallContent,
  EvaluationResult,
} from "@language-drill/shared";
import { buildUserPrompt, EVALUATION_SYSTEM_PROMPT } from "./prompts.js";
import {
  evaluateAnswer,
  parseEvaluationResult,
  EVALUATION_TOOL_NAME,
  EVALUATION_TOOL,
} from "./evaluate.js";
import { createClaudeClient } from "./index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const clozeContent: ClozeContent = {
  type: ExerciseType.CLOZE,
  instructions: "Fill in the blank with the correct form.",
  sentence: "She ___ to the store yesterday.",
  correctAnswer: "went",
  options: ["went", "go", "gone"],
  context: "Past tense of 'go'",
};

const translationContent: TranslationContent = {
  type: ExerciseType.TRANSLATION,
  instructions: "Translate the following sentence.",
  sourceText: "The cat is on the table.",
  sourceLanguage: Language.EN,
  targetLanguage: Language.ES,
  referenceTranslation: "El gato esta en la mesa.",
};

const vocabRecallContent: VocabRecallContent = {
  type: ExerciseType.VOCAB_RECALL,
  instructions: "What is the word?",
  prompt: "A place where you borrow books",
  expectedWord: "library",
  hints: ["starts with L", "has 7 letters"],
  exampleSentence: "I returned my books to the library.",
};

const validEvaluationInput = {
  score: 0.85,
  grammarAccuracy: 0.9,
  vocabularyRange: "B2",
  taskAchievement: 0.8,
  feedback: "Good answer with minor issues.",
  errors: [
    {
      type: "grammar",
      severity: "minor",
      text: "She go",
      correction: "She goes",
      explanation: "Third person singular requires -s.",
    },
  ],
  estimatedCefrEvidence: "B2",
};

// ---------------------------------------------------------------------------
// Prompt construction tests
// ---------------------------------------------------------------------------

describe("buildUserPrompt", () => {
  it("builds a cloze prompt with all fields", () => {
    const prompt = buildUserPrompt(clozeContent, "went", Language.EN, CefrLevel.B1);

    expect(prompt).toContain("Exercise Type: Cloze");
    expect(prompt).toContain("Language:** EN");
    expect(prompt).toContain("Target CEFR Level:** B1");
    expect(prompt).toContain("She ___ to the store yesterday.");
    expect(prompt).toContain("Correct Answer:** went");
    expect(prompt).toContain("User's Answer:** went");
    expect(prompt).toContain("Context:** Past tense of 'go'");
    expect(prompt).toContain("Options:** went, go, gone");
  });

  it("builds a cloze prompt without optional fields", () => {
    const minimal: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "Fill in the blank.",
      sentence: "I ___ happy.",
      correctAnswer: "am",
    };

    const prompt = buildUserPrompt(minimal, "am", Language.EN, CefrLevel.A1);

    expect(prompt).toContain("Exercise Type: Cloze");
    expect(prompt).not.toContain("Context:**");
    expect(prompt).not.toContain("Options:**");
  });

  it("builds a translation prompt with all fields", () => {
    const prompt = buildUserPrompt(
      translationContent,
      "El gato esta en la mesa.",
      Language.ES,
      CefrLevel.A2,
    );

    expect(prompt).toContain("Exercise Type: Translation");
    expect(prompt).toContain("Language:** ES");
    expect(prompt).toContain("Target CEFR Level:** A2");
    expect(prompt).toContain("Source Text (EN):** The cat is on the table.");
    expect(prompt).toContain("Target Language:** ES");
    expect(prompt).toContain("Reference Translation:** El gato esta en la mesa.");
    expect(prompt).toContain("User's Translation:** El gato esta en la mesa.");
  });

  it("builds a vocab recall prompt with all fields", () => {
    const prompt = buildUserPrompt(
      vocabRecallContent,
      "library",
      Language.EN,
      CefrLevel.A2,
    );

    expect(prompt).toContain("Exercise Type: Vocabulary Recall");
    expect(prompt).toContain("Language:** EN");
    expect(prompt).toContain("Prompt:** A place where you borrow books");
    expect(prompt).toContain("Expected Word:** library");
    expect(prompt).toContain("Hints:** starts with L; has 7 letters");
    expect(prompt).toContain("User's Answer:** library");
  });
});

describe("EVALUATION_SYSTEM_PROMPT", () => {
  it("contains CEFR level descriptors", () => {
    expect(EVALUATION_SYSTEM_PROMPT).toContain("A1");
    expect(EVALUATION_SYSTEM_PROMPT).toContain("C2");
  });

  it("contains language-specific notes", () => {
    expect(EVALUATION_SYSTEM_PROMPT).toContain("English (EN)");
    expect(EVALUATION_SYSTEM_PROMPT).toContain("Spanish (ES)");
    expect(EVALUATION_SYSTEM_PROMPT).toContain("German (DE)");
    expect(EVALUATION_SYSTEM_PROMPT).toContain("Turkish (TR)");
  });

  it("mentions tool usage requirement", () => {
    expect(EVALUATION_SYSTEM_PROMPT).toContain("MUST use the provided tool");
  });

  it("contains language-specific details", () => {
    expect(EVALUATION_SYSTEM_PROMPT).toContain("subjuntivo");
    expect(EVALUATION_SYSTEM_PROMPT).toContain("vowel harmony");
    expect(EVALUATION_SYSTEM_PROMPT).toContain("Akkusativ");
  });
});

// ---------------------------------------------------------------------------
// parseEvaluationResult tests
// ---------------------------------------------------------------------------

describe("parseEvaluationResult", () => {
  it("parses a valid evaluation result", () => {
    const result = parseEvaluationResult(validEvaluationInput);

    expect(result.score).toBe(0.85);
    expect(result.grammarAccuracy).toBe(0.9);
    expect(result.vocabularyRange).toBe("B2");
    expect(result.taskAchievement).toBe(0.8);
    expect(result.feedback).toBe("Good answer with minor issues.");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].type).toBe("grammar");
    expect(result.errors[0].severity).toBe("minor");
    expect(result.estimatedCefrEvidence).toBe("B2");
  });

  it("parses a result with empty errors array", () => {
    const input = { ...validEvaluationInput, errors: [] };
    const result = parseEvaluationResult(input);
    expect(result.errors).toHaveLength(0);
  });

  it("throws for null input", () => {
    expect(() => parseEvaluationResult(null)).toThrow("must be an object");
  });

  it("throws for non-object input", () => {
    expect(() => parseEvaluationResult("string")).toThrow("must be an object");
  });

  it("throws for score out of range", () => {
    expect(() =>
      parseEvaluationResult({ ...validEvaluationInput, score: 1.5 }),
    ).toThrow("Invalid score");
  });

  it("throws for negative grammarAccuracy", () => {
    expect(() =>
      parseEvaluationResult({ ...validEvaluationInput, grammarAccuracy: -0.1 }),
    ).toThrow("Invalid grammarAccuracy");
  });

  it("throws for non-number taskAchievement", () => {
    expect(() =>
      parseEvaluationResult({ ...validEvaluationInput, taskAchievement: "high" }),
    ).toThrow("Invalid taskAchievement");
  });

  it("throws for empty feedback", () => {
    expect(() =>
      parseEvaluationResult({ ...validEvaluationInput, feedback: "" }),
    ).toThrow("Invalid feedback");
  });

  it("throws for missing vocabularyRange", () => {
    expect(() =>
      parseEvaluationResult({ ...validEvaluationInput, vocabularyRange: undefined }),
    ).toThrow("Invalid vocabularyRange");
  });

  it("throws for invalid error type", () => {
    expect(() =>
      parseEvaluationResult({
        ...validEvaluationInput,
        errors: [{ ...validEvaluationInput.errors[0], type: "style" }],
      }),
    ).toThrow("Invalid error type");
  });

  it("throws for invalid error severity", () => {
    expect(() =>
      parseEvaluationResult({
        ...validEvaluationInput,
        errors: [{ ...validEvaluationInput.errors[0], severity: "critical" }],
      }),
    ).toThrow("Invalid error severity");
  });

  it("throws for non-array errors", () => {
    expect(() =>
      parseEvaluationResult({ ...validEvaluationInput, errors: "none" }),
    ).toThrow("Invalid errors: must be an array");
  });

  it("throws for error with non-string text field", () => {
    expect(() =>
      parseEvaluationResult({
        ...validEvaluationInput,
        errors: [{ ...validEvaluationInput.errors[0], text: 123 }],
      }),
    ).toThrow("Invalid error text");
  });
});

// ---------------------------------------------------------------------------
// EVALUATION_TOOL schema tests
// ---------------------------------------------------------------------------

describe("EVALUATION_TOOL", () => {
  it("has the correct tool name", () => {
    expect(EVALUATION_TOOL.name).toBe("submit_evaluation");
  });

  it("has all required fields in the schema", () => {
    const required = EVALUATION_TOOL.input_schema.required as string[];
    expect(required).toContain("score");
    expect(required).toContain("grammarAccuracy");
    expect(required).toContain("vocabularyRange");
    expect(required).toContain("taskAchievement");
    expect(required).toContain("feedback");
    expect(required).toContain("errors");
    expect(required).toContain("estimatedCefrEvidence");
  });
});

// ---------------------------------------------------------------------------
// evaluateAnswer tests (mocked SDK)
// ---------------------------------------------------------------------------

describe("evaluateAnswer", () => {
  const mockCreate = vi.fn();
  const mockClient = {
    messages: { create: mockCreate },
  } as unknown as ReturnType<typeof createClaudeClient>;

  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("calls Claude with correct parameters and returns parsed result", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_123",
          name: EVALUATION_TOOL_NAME,
          input: validEvaluationInput,
        },
      ],
      stop_reason: "tool_use",
    });

    const result = await evaluateAnswer(mockClient, {
      exercise: clozeContent,
      userAnswer: "went",
      language: Language.EN,
      difficulty: CefrLevel.B1,
    });

    expect(result.score).toBe(0.85);
    expect(result.grammarAccuracy).toBe(0.9);
    expect(result.errors).toHaveLength(1);

    // Verify the SDK was called correctly
    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe("claude-sonnet-4-5");
    expect(callArgs.temperature).toBe(0);
    expect(callArgs.tools).toHaveLength(1);
    expect(callArgs.tools[0].name).toBe(EVALUATION_TOOL_NAME);
    expect(callArgs.tool_choice).toEqual({
      type: "tool",
      name: EVALUATION_TOOL_NAME,
    });

    // Verify system prompt uses cache_control
    expect(callArgs.system).toEqual([
      {
        type: "text",
        text: EVALUATION_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("throws when Claude returns no tool use block", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "I cannot evaluate this." }],
      stop_reason: "end_turn",
    });

    await expect(
      evaluateAnswer(mockClient, {
        exercise: clozeContent,
        userAnswer: "went",
        language: Language.EN,
        difficulty: CefrLevel.B1,
      }),
    ).rejects.toThrow("Claude did not return a tool use block");
  });

  it("throws when Claude returns wrong tool name", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_456",
          name: "wrong_tool",
          input: validEvaluationInput,
        },
      ],
      stop_reason: "tool_use",
    });

    await expect(
      evaluateAnswer(mockClient, {
        exercise: clozeContent,
        userAnswer: "went",
        language: Language.EN,
        difficulty: CefrLevel.B1,
      }),
    ).rejects.toThrow("Unexpected tool name");
  });

  it("throws when Claude returns malformed tool input", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_789",
          name: EVALUATION_TOOL_NAME,
          input: { score: "not a number" },
        },
      ],
      stop_reason: "tool_use",
    });

    await expect(
      evaluateAnswer(mockClient, {
        exercise: translationContent,
        userAnswer: "El gato esta en la mesa.",
        language: Language.ES,
        difficulty: CefrLevel.A2,
      }),
    ).rejects.toThrow("Invalid score");
  });

  it("propagates SDK errors", async () => {
    mockCreate.mockRejectedValue(new Error("API rate limit exceeded"));

    await expect(
      evaluateAnswer(mockClient, {
        exercise: vocabRecallContent,
        userAnswer: "library",
        language: Language.EN,
        difficulty: CefrLevel.A2,
      }),
    ).rejects.toThrow("API rate limit exceeded");
  });

  it("works with translation exercises", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_trans",
          name: EVALUATION_TOOL_NAME,
          input: { ...validEvaluationInput, score: 1.0, errors: [] },
        },
      ],
      stop_reason: "tool_use",
    });

    const result = await evaluateAnswer(mockClient, {
      exercise: translationContent,
      userAnswer: "El gato esta en la mesa.",
      language: Language.ES,
      difficulty: CefrLevel.A2,
    });

    expect(result.score).toBe(1.0);
    expect(result.errors).toHaveLength(0);

    // Verify user prompt was constructed for translation
    const userMsg = mockCreate.mock.calls[0][0].messages[0].content;
    expect(userMsg).toContain("Translation");
  });

  it("works with vocab recall exercises", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_vocab",
          name: EVALUATION_TOOL_NAME,
          input: validEvaluationInput,
        },
      ],
      stop_reason: "tool_use",
    });

    const result = await evaluateAnswer(mockClient, {
      exercise: vocabRecallContent,
      userAnswer: "library",
      language: Language.EN,
      difficulty: CefrLevel.A2,
    });

    expect(result.score).toBe(0.85);

    // Verify user prompt was constructed for vocab recall
    const userMsg = mockCreate.mock.calls[0][0].messages[0].content;
    expect(userMsg).toContain("Vocabulary Recall");
  });
});

// ---------------------------------------------------------------------------
// createClaudeClient tests
// ---------------------------------------------------------------------------

describe("createClaudeClient", () => {
  it("returns an Anthropic client instance", () => {
    // We can't fully instantiate without env, but we can verify the function
    // returns an object with the expected shape
    const client = createClaudeClient("test-api-key");
    expect(client).toBeDefined();
    expect(client.messages).toBeDefined();
  });
});
