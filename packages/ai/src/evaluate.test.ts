import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Language,
  CefrLevel,
  ExerciseType,
} from "@language-drill/shared";
import type {
  ClozeContent,
  TranslationContent,
  VocabRecallContent,
  SentenceConstructionContent,
} from "@language-drill/shared";
import {
  buildUserPrompt,
  EVALUATION_SYSTEM_PROMPT,
  EVALUATION_SYSTEM_PROMPT_VERSION,
} from "./prompts.js";
import {
  evaluateAnswer,
  parseEvaluationResult,
  EVALUATION_TOOL_NAME,
  EVALUATION_TOOL,
} from "./evaluate.js";
import { createClaudeClient } from "./index.js";
import {
  __resetForTests as __resetObservabilityForTests,
  getCurrentLlmTraceContext,
  withLlmTrace,
  type LlmTraceContext,
} from "./observability.js";
import {
  __resetRegistryForTests,
  sha8,
} from "./prompts-registry.js";

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

  it("appends an authoritative grammar reference block when grammarGuidance is provided", () => {
    const guidance = {
      name: "Vowel harmony",
      description:
        "Suffix vowels harmonise with the stem's last vowel. 2-way (e/a): plural -lAr.",
      commonErrors: [
        "Defaulting to one vowel form regardless of the stem vowel.",
        "Soft-l loanwords like meşgul take -ler not -lar (meşgul → meşguller).",
      ],
    };

    const prompt = buildUserPrompt(
      translationContent,
      "Onlar meşgullar.",
      Language.TR,
      CefrLevel.A1,
      guidance,
    );

    // Names the grammar point being drilled
    expect(prompt).toContain("Vowel harmony");
    // Surfaces the authoritative rule + the specific exception bullet
    expect(prompt).toContain("Suffix vowels harmonise with the stem's last vowel");
    expect(prompt).toContain("meşgul → meşguller");
    // Anti-confabulation instruction so the evaluator stops inventing rules
    expect(prompt.toLowerCase()).toContain("do not invent");
  });

  it("omits the grammar reference block when grammarGuidance is absent", () => {
    const prompt = buildUserPrompt(clozeContent, "went", Language.EN, CefrLevel.B1);

    expect(prompt).not.toContain("Grammar Point Reference");
    expect(prompt.toLowerCase()).not.toContain("do not invent");
  });

  it("throws for a dictation exercise (not evaluated via this path)", () => {
    const dictationContent = {
      type: ExerciseType.DICTATION,
      title: "Test clip",
      referenceText: "Hello world",
      sentences: ["Hello world"],
      accent: "EN neutral",
      voiceId: "Joanna",
      tested: ["listening"],
      durationSec: 3,
      waveform: [0.5, 0.5],
    } as import("@language-drill/shared").DictationContent;
    expect(() =>
      buildUserPrompt(dictationContent, "hello world", Language.EN, CefrLevel.B1),
    ).toThrow("Dictation exercises are not evaluated via this path");
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
    expect(EVALUATION_SYSTEM_PROMPT).toContain("Akkusativ");
  });

  it("grounds the Turkish vowel inventory so the evaluator cannot fabricate classes (tr-harmony-eval-grounding R4.1, R4.2)", () => {
    // The explicit inventory + the corrective that o/a are back vowels.
    expect(EVALUATION_SYSTEM_PROMPT).toContain("front: e, i, ö, ü");
    expect(EVALUATION_SYSTEM_PROMPT).toContain("back: a, ı, o, u");
    expect(EVALUATION_SYSTEM_PROMPT).toContain('"o" and "a" are BACK vowels');
    // Harmony keys off the last vowel only, illustrated with the borrowed word.
    expect(EVALUATION_SYSTEM_PROMPT).toContain("LAST vowel of the stem only");
    expect(EVALUATION_SYSTEM_PROMPT).toContain("domates");
  });

  it("bumps EVALUATION_SYSTEM_PROMPT_VERSION for the grounded prompt (R4.3)", () => {
    expect(EVALUATION_SYSTEM_PROMPT_VERSION).toBe("evaluate@2026-05-24");
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
    expect(callArgs.model).toBe("claude-haiku-4-5-20251001");
    // Timeout/maxRetries are applied at client construction (in the route via
    // createObservedClaudeClient), NOT per-request here — lock that evaluate.ts
    // passes no second request-options arg to messages.create. (Req 4.1)
    expect(mockCreate.mock.calls[0][1]).toBeUndefined();
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
// evaluateAnswer + prompts-registry integration (Phase 2 — Task 7)
// ---------------------------------------------------------------------------

/**
 * These cases pin the override + fallback paths for Phase 2's
 * `getPromptOrFallback` integration. Tests above already cover the
 * default path (LANGFUSE_PUBLIC_KEY unset → fallback prompt text matches
 * the in-repo `EVALUATION_SYSTEM_PROMPT` byte-for-byte); the cases here
 * specifically assert:
 *
 *   - The `systemPromptOverride` field plumbs the candidate text through
 *     to `messages.create` verbatim, AND stamps the trace with
 *     `promptVersion=override:<sha8>` so eval-runner traces don't pollute
 *     production cohort dashboards.
 *   - Without an override, the resolved version on the ALS frame is the
 *     `fallback:<localVersion>` form (since the test suite runs with
 *     `LANGFUSE_PUBLIC_KEY` unset by default, so the registry takes the
 *     fallback path).
 */
describe("evaluateAnswer + prompts-registry", () => {
  const mockCreate = vi.fn();
  const mockClient = {
    messages: { create: mockCreate },
  } as unknown as ReturnType<typeof createClaudeClient>;

  const ENV_KEYS = [
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
    "LANGFUSE_BASE_URL",
  ] as const;
  const envSnapshot = new Map<string, string | undefined>();

  beforeEach(() => {
    // Test suite runs with Langfuse keys unset by default — be explicit so
    // these cases don't depend on shell state.
    for (const k of ENV_KEYS) {
      envSnapshot.set(k, process.env[k]);
      delete process.env[k];
    }
    mockCreate.mockReset();
    __resetRegistryForTests();
    __resetObservabilityForTests();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = envSnapshot.get(k);
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    __resetRegistryForTests();
    __resetObservabilityForTests();
  });

  function baseCtx(
    overrides: Partial<LlmTraceContext> = {},
  ): LlmTraceContext {
    return {
      feature: "evaluate",
      env: "dev",
      promptVersion: "pending",
      requestId: "test-request-001",
      userId: "dev_user_001",
      language: Language.EN,
      cefrLevel: CefrLevel.B1,
      exerciseType: ExerciseType.CLOZE,
      ...overrides,
    };
  }

  function mockClaudeResponse(): void {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_phase2",
          name: EVALUATION_TOOL_NAME,
          input: validEvaluationInput,
        },
      ],
      stop_reason: "tool_use",
    });
  }

  it("uses systemPromptOverride verbatim in the messages.create system block", async () => {
    mockClaudeResponse();
    const override = "CUSTOM_CANDIDATE_PROMPT body for eval run";

    await evaluateAnswer(mockClient, {
      exercise: clozeContent,
      userAnswer: "went",
      language: Language.EN,
      difficulty: CefrLevel.B1,
      systemPromptOverride: override,
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toEqual([
      {
        type: "text",
        text: override,
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("stamps promptVersion=override:<sha8> on the trace when systemPromptOverride is set", async () => {
    mockClaudeResponse();
    const override = "CUSTOM_CANDIDATE_PROMPT body for eval run";
    const expectedTag = `override:${sha8(override)}`;

    await withLlmTrace(baseCtx(), async () => {
      await evaluateAnswer(mockClient, {
        exercise: clozeContent,
        userAnswer: "went",
        language: Language.EN,
        difficulty: CefrLevel.B1,
        systemPromptOverride: override,
      });
      const ctx = getCurrentLlmTraceContext();
      expect(ctx?.promptVersion).toBe(expectedTag);
      expect(ctx?.promptFallback).toBe(false);
    });
  });

  it("falls back to EVALUATION_SYSTEM_PROMPT with `fallback:<v>` promptVersion when no override + Langfuse unset", async () => {
    // LANGFUSE_PUBLIC_KEY is unset (beforeEach), so the registry takes the
    // fallback path — system text must be the in-repo string, promptVersion
    // must be the `fallback:<localVersion>` cohort tag.
    mockClaudeResponse();
    const expectedTag = `fallback:${EVALUATION_SYSTEM_PROMPT_VERSION}`;

    await withLlmTrace(baseCtx(), async () => {
      await evaluateAnswer(mockClient, {
        exercise: clozeContent,
        userAnswer: "went",
        language: Language.EN,
        difficulty: CefrLevel.B1,
      });
      const ctx = getCurrentLlmTraceContext();
      expect(ctx?.promptVersion).toBe(expectedTag);
      expect(ctx?.promptFallback).toBe(true);
    });

    // Sanity: the fallback path produces byte-identical system text to
    // pre-Phase-2 behavior.
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toEqual([
      {
        type: "text",
        text: EVALUATION_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("does not call setResolvedPromptVersion on the override path with fromFallback=true", async () => {
    // Override path explicitly passes `false` to fromFallback. Confirm the
    // trace metadata reflects that — eval-runner output should never look
    // like a fallback to dashboards.
    mockClaudeResponse();
    const override = "another candidate";

    await withLlmTrace(baseCtx(), async () => {
      await evaluateAnswer(mockClient, {
        exercise: clozeContent,
        userAnswer: "went",
        language: Language.EN,
        difficulty: CefrLevel.B1,
        systemPromptOverride: override,
      });
      const ctx = getCurrentLlmTraceContext();
      expect(ctx?.promptFallback).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// buildUserPrompt — sentence construction
// ---------------------------------------------------------------------------

describe("buildUserPrompt — sentence construction", () => {
  const content: SentenceConstructionContent = {
    type: ExerciseType.SENTENCE_CONSTRUCTION,
    instructions: "Write one sentence in Spanish.",
    promptMode: "keywords",
    prompt: "Use these words: ayer, biblioteca, libro.",
    keywords: ["ayer", "biblioteca", "libro"],
    register: "neutral",
    modelAnswers: ["Ayer olvidé un libro en la biblioteca.", "Ayer dejé el libro en la biblioteca."],
  };

  it("includes the prompt, mode, keywords, register and the user's answer", () => {
    const msg = buildUserPrompt(content, "Ayer fui a la biblioteca y cogí un libro.", Language.ES, CefrLevel.B1);
    expect(msg).toContain("Sentence Construction");
    expect(msg).toContain("Use these words: ayer, biblioteca, libro.");
    expect(msg).toContain("ayer, biblioteca, libro");
    expect(msg).toContain("keywords");
    expect(msg).toContain("Ayer fui a la biblioteca");
    expect(msg).toContain("neutral");
    expect(msg).toMatch(/do NOT require a match/i);
    expect(msg).toContain(content.modelAnswers[0]);
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
