import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CefrLevel,
  ExerciseType,
  Language,
  isClozeContent,
  isTranslationContent,
  isVocabRecallContent,
  type VocabRecallContent,
} from "@language-drill/shared";
import { getGrammarPoint } from "@language-drill/db";

import { createClaudeClient } from "./index.js";
import {
  CLOZE_GENERATION_TOOL,
  DICTATION_GENERATION_TOOL,
  DICTATION_VOICE_POOL_BY_LANGUAGE,
  GENERATION_MODEL,
  GENERATION_TEMPERATURE,
  GENERATION_TOOL_BY_TYPE,
  SENTENCE_CONSTRUCTION_GENERATION_TOOL,
  TOOL_NAME_BY_TYPE,
  TRANSLATION_GENERATION_TOOL,
  VOCAB_RECALL_GENERATION_TOOL,
  exerciseDraftId,
  generateBatch,
  generateOneDraft,
  parseGeneratedClozeDraft,
  parseGeneratedConjugationDraft,
  parseGeneratedDictationDraft,
  parseGeneratedFreeWritingDraft,
  parseGeneratedSentenceConstructionDraft,
  type GenerationSpec,
} from "./generate.js";

// Wrap `buildGenerationSystemPrompt` in a call-through spy so the
// `systemPromptOverride` seam test can assert it is NOT invoked on the
// override path (Req 2.1) while leaving every other export — and the
// function's real behavior — untouched for the rest of the suite (Req 2.2).
vi.mock("./generation-prompts.js", async (importActual) => {
  const actual =
    await importActual<typeof import("./generation-prompts.js")>();
  return {
    ...actual,
    buildGenerationSystemPrompt: vi.fn(actual.buildGenerationSystemPrompt),
  };
});
import { buildGenerationSystemPrompt } from "./generation-prompts.js";

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

const validClozeInput = {
  instructions: "Fill the blank with the correct subjunctive form.",
  sentence: "Espero que ___ a tiempo.",
  correctAnswer: "lleguen",
};

const validTranslationInput = {
  instructions: "Translate the following sentence into Spanish.",
  sourceText: "I hope you arrive on time.",
  sourceLanguage: "EN",
  targetLanguage: "ES",
  referenceTranslation: "Espero que llegues a tiempo.",
};

const validVocabInput = {
  instructions: "Produce the word that fits the description.",
  prompt: "A place where books are borrowed.",
  expectedWord: "biblioteca",
  hints: ["Starts with B", "8 letters"],
  exampleSentence: "Voy a la biblioteca para estudiar.",
};

const baseUsage = {
  input_tokens: 100,
  cache_creation_input_tokens: 50,
  cache_read_input_tokens: 0,
  output_tokens: 200,
};

// ---------------------------------------------------------------------------
// Cross-file invariants
// ---------------------------------------------------------------------------

describe("GENERATION_MODEL", () => {
  it("matches the literal evaluate.ts pins (cross-file invariant)", () => {
    expect(GENERATION_MODEL).toBe("claude-sonnet-4-6");
  });
});

describe("Tool-name DRY", () => {
  it("TOOL_NAME_BY_TYPE.cloze === CLOZE_GENERATION_TOOL.name", () => {
    expect(TOOL_NAME_BY_TYPE.cloze).toBe(CLOZE_GENERATION_TOOL.name);
  });

  it("TOOL_NAME_BY_TYPE.translation === TRANSLATION_GENERATION_TOOL.name", () => {
    expect(TOOL_NAME_BY_TYPE.translation).toBe(
      TRANSLATION_GENERATION_TOOL.name,
    );
  });

  it("TOOL_NAME_BY_TYPE.vocab_recall === VOCAB_RECALL_GENERATION_TOOL.name", () => {
    expect(TOOL_NAME_BY_TYPE.vocab_recall).toBe(
      VOCAB_RECALL_GENERATION_TOOL.name,
    );
  });
});

// ---------------------------------------------------------------------------
// exerciseDraftId
// ---------------------------------------------------------------------------

describe("exerciseDraftId", () => {
  it("is deterministic for identical (spec, ordinal)", () => {
    expect(exerciseDraftId(baseSpec, 0)).toBe(exerciseDraftId(baseSpec, 0));
  });

  it("varies by ordinal", () => {
    expect(exerciseDraftId(baseSpec, 0)).not.toBe(exerciseDraftId(baseSpec, 1));
  });

  it("varies by batchSeed", () => {
    expect(exerciseDraftId(baseSpec, 0)).not.toBe(
      exerciseDraftId({ ...baseSpec, batchSeed: "different" }, 0),
    );
  });

  it("varies by language", () => {
    expect(exerciseDraftId(baseSpec, 0)).not.toBe(
      exerciseDraftId({ ...baseSpec, language: Language.DE }, 0),
    );
  });

  it("returns a UUID-shaped string", () => {
    expect(exerciseDraftId(baseSpec, 0)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

// ---------------------------------------------------------------------------
// parseGeneratedClozeDraft — optional glossEn (R2.3, R2.6)
// ---------------------------------------------------------------------------

describe("parseGeneratedClozeDraft glossEn", () => {
  it("exposes glossEn as an optional property on the cloze tool schema", () => {
    const props = CLOZE_GENERATION_TOOL.input_schema.properties as Record<
      string,
      unknown
    >;
    expect(props.glossEn).toBeDefined();
    // Optional: must NOT be in the tool's required list.
    expect(CLOZE_GENERATION_TOOL.input_schema.required).not.toContain("glossEn");
  });

  it("parses glossEn when present, mirroring context/topicHint", () => {
    const content = parseGeneratedClozeDraft(
      {
        ...validClozeInput,
        glossEn: "My mother is drinking the coffee",
      },
      baseSpec,
    );
    expect(content.glossEn).toBe("My mother is drinking the coffee");
  });

  it("omits glossEn entirely when absent (key not present)", () => {
    const content = parseGeneratedClozeDraft(validClozeInput, baseSpec);
    expect(content.glossEn).toBeUndefined();
    expect("glossEn" in content).toBe(false);
  });

  it("rejects a non-string glossEn (same guard as other optional strings)", () => {
    expect(() =>
      parseGeneratedClozeDraft(
        { ...validClozeInput, glossEn: 42 },
        baseSpec,
      ),
    ).toThrow(/glossEn/);
  });
});

// ---------------------------------------------------------------------------
// generateBatch (mocked SDK)
// ---------------------------------------------------------------------------

describe("generateBatch", () => {
  const mockCreate = vi.fn();
  const mockClient = {
    messages: { create: mockCreate },
  } as unknown as ReturnType<typeof createClaudeClient>;

  beforeEach(() => {
    mockCreate.mockReset();
  });

  // ---- Happy-path × 3 types ----

  it("produces a valid cloze draft and dispatches the cloze tool", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: TOOL_NAME_BY_TYPE.cloze,
          input: validClozeInput,
        },
      ],
      stop_reason: "tool_use",
      usage: baseUsage,
    });

    const { drafts, tokenUsage, malformedDrafts } = await generateBatch(
      mockClient,
      baseSpec,
    );

    expect(drafts).toHaveLength(1);
    expect(isClozeContent(drafts[0].contentJson)).toBe(true);
    expect(drafts[0].metadata.modelId).toBe(GENERATION_MODEL);
    expect(drafts[0].metadata.grammarPointKey).toBe(grammarPoint.key);
    expect(drafts[0].metadata.inBatchDuplicate).toBe(false);
    expect(tokenUsage.inputTokens).toBe(baseUsage.input_tokens);
    expect(tokenUsage.outputTokens).toBe(baseUsage.output_tokens);
    expect(malformedDrafts).toEqual([]);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe(GENERATION_MODEL);
    expect(callArgs.temperature).toBe(GENERATION_TEMPERATURE);
    expect(callArgs.tools).toHaveLength(1);
    expect(callArgs.tool_choice).toEqual({
      type: "tool",
      name: TOOL_NAME_BY_TYPE.cloze,
    });
    expect(callArgs.system).toEqual([
      {
        type: "text",
        text: expect.any(String),
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("threads acceptableAnswers through the cloze parser when supplied", async () => {
    // Regression: the "Sınıfta sekiz ___ var" case from Turkish A1. The
    // generator must be able to declare every lexeme that satisfies the
    // grammar point so the evaluator marks chair/student/book/etc. as
    // fully correct.
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_1b",
          name: TOOL_NAME_BY_TYPE.cloze,
          input: {
            ...validClozeInput,
            acceptableAnswers: ["llegues", "vengas", "estés"],
          },
        },
      ],
      stop_reason: "tool_use",
      usage: baseUsage,
    });

    const { drafts } = await generateBatch(mockClient, baseSpec);
    const content = drafts[0].contentJson;
    expect(content.type).toBe(ExerciseType.CLOZE);
    if (content.type !== ExerciseType.CLOZE) throw new Error("type guard");
    expect(content.acceptableAnswers).toEqual(["llegues", "vengas", "estés"]);
  });

  it("omits acceptableAnswers from the draft when the generator passes an empty array", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_1c",
          name: TOOL_NAME_BY_TYPE.cloze,
          input: { ...validClozeInput, acceptableAnswers: [] },
        },
      ],
      stop_reason: "tool_use",
      usage: baseUsage,
    });

    const { drafts } = await generateBatch(mockClient, baseSpec);
    const content = drafts[0].contentJson;
    if (content.type !== ExerciseType.CLOZE) throw new Error("type guard");
    expect(content.acceptableAnswers).toBeUndefined();
  });

  it("rejects acceptableAnswers entries that are empty/whitespace", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_1d",
          name: TOOL_NAME_BY_TYPE.cloze,
          input: { ...validClozeInput, acceptableAnswers: ["llegues", "   "] },
        },
      ],
      stop_reason: "tool_use",
      usage: baseUsage,
    });

    const { drafts, malformedDrafts } = await generateBatch(
      mockClient,
      baseSpec,
    );
    expect(drafts).toEqual([]);
    expect(malformedDrafts).toHaveLength(1);
    expect(malformedDrafts[0].errorMessage).toContain("acceptableAnswers[1]");
  });

  it("produces a valid translation draft and dispatches the translation tool", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_2",
          name: TOOL_NAME_BY_TYPE.translation,
          input: validTranslationInput,
        },
      ],
      stop_reason: "tool_use",
      usage: baseUsage,
    });

    const { drafts } = await generateBatch(mockClient, {
      ...baseSpec,
      exerciseType: ExerciseType.TRANSLATION,
    });

    expect(drafts).toHaveLength(1);
    expect(isTranslationContent(drafts[0].contentJson)).toBe(true);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.tool_choice.name).toBe(TOOL_NAME_BY_TYPE.translation);
  });

  it("produces a valid vocab_recall draft and dispatches the vocab tool", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_3",
          name: TOOL_NAME_BY_TYPE.vocab_recall,
          input: validVocabInput,
        },
      ],
      stop_reason: "tool_use",
      usage: baseUsage,
    });

    const { drafts } = await generateBatch(mockClient, {
      ...baseSpec,
      exerciseType: ExerciseType.VOCAB_RECALL,
    });

    expect(drafts).toHaveLength(1);
    expect(isVocabRecallContent(drafts[0].contentJson)).toBe(true);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.tool_choice.name).toBe(TOOL_NAME_BY_TYPE.vocab_recall);
  });

  // ---- Guards ----

  it("rejects EN before any Claude call", async () => {
    const enSpec = { ...baseSpec, language: Language.EN } as unknown as GenerationSpec;
    await expect(generateBatch(mockClient, enSpec)).rejects.toThrow(
      /resolved decision #4/,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects unsupported exerciseType before any Claude call", async () => {
    const unsupported = {
      ...baseSpec,
      exerciseType: "listening" as unknown as ExerciseType,
    };
    await expect(generateBatch(mockClient, unsupported)).rejects.toThrow(
      /Unsupported exerciseType/,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ---- Per-ordinal loss tolerance ----
  //
  // The three malformed-response cases below used to abort the whole batch;
  // post-loss-tolerance they capture the failure into `malformedDrafts` and
  // continue. With count=1 the batch returns 0 drafts + 1 malformed entry.
  // Token usage still folds in — Claude's call cost real tokens. See
  // `.claude/bugs/cloze-empty-correct-answer/` and
  // `.claude/bugs/vocab-recall-multi-word-rejected/` for the production
  // incidents that motivated the change.

  it("records malformed instead of throwing when no tool_use block is returned", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Sorry, I cannot do that." }],
      stop_reason: "end_turn",
      usage: baseUsage,
    });

    const { drafts, malformedDrafts, tokenUsage } = await generateBatch(
      mockClient,
      baseSpec,
    );

    expect(drafts).toHaveLength(0);
    expect(malformedDrafts).toHaveLength(1);
    expect(malformedDrafts[0].ordinal).toBe(0);
    expect(malformedDrafts[0].errorMessage).toMatch(
      /ordinal=0 malformed: no tool_use block returned \(stop_reason=end_turn\)/,
    );
    // Token usage still accounted for — Claude's call cost real tokens.
    expect(tokenUsage.inputTokens).toBe(baseUsage.input_tokens);
    expect(tokenUsage.outputTokens).toBe(baseUsage.output_tokens);
  });

  it("records malformed instead of throwing when the tool name is wrong", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_x",
          name: "submit_random_thing",
          input: validClozeInput,
        },
      ],
      stop_reason: "tool_use",
      usage: baseUsage,
    });

    const { drafts, malformedDrafts } = await generateBatch(
      mockClient,
      baseSpec,
    );

    expect(drafts).toHaveLength(0);
    expect(malformedDrafts).toHaveLength(1);
    expect(malformedDrafts[0].errorMessage).toMatch(
      /ordinal=0 malformed: expected tool 'submit_cloze_exercise'/,
    );
  });

  it("records malformed instead of throwing when the parser rejects the tool input", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_y",
          name: TOOL_NAME_BY_TYPE.cloze,
          input: {
            ...validClozeInput,
            sentence: "no blank here", // missing '___' → cloze parser throws
          },
        },
      ],
      stop_reason: "tool_use",
      usage: baseUsage,
    });

    const { drafts, malformedDrafts } = await generateBatch(
      mockClient,
      baseSpec,
    );

    expect(drafts).toHaveLength(0);
    expect(malformedDrafts).toHaveLength(1);
    expect(malformedDrafts[0].errorMessage).toMatch(
      /ordinal=0 malformed: cloze draft: invalid sentence/,
    );
  });

  it("salvages surrounding drafts when one ordinal in the middle is malformed", async () => {
    // Three calls: two valid clozes flanking one with an empty correctAnswer
    // (the actual production failure from 2026-05-12, jobId 58f8f79c).
    let callIndex = 0;
    mockCreate.mockImplementation(() => {
      const idx = callIndex++;
      const sentence = `Espero que ___ pronto número ${idx}.`;
      const input = {
        ...validClozeInput,
        sentence,
        // Middle ordinal mimics the production "correctAnswer must contain
        // non-whitespace characters" throw path.
        correctAnswer: idx === 1 ? "" : `lleguen${idx}`,
      };
      return Promise.resolve({
        content: [
          {
            type: "tool_use",
            id: `toolu_${idx}`,
            name: TOOL_NAME_BY_TYPE.cloze,
            input,
          },
        ],
        stop_reason: "tool_use",
        usage: baseUsage,
      });
    });

    const { drafts, malformedDrafts, tokenUsage } = await generateBatch(
      mockClient,
      { ...baseSpec, count: 3 },
    );

    // Surrounding ordinals (0 and 2) survived; ordinal 1 was captured.
    expect(drafts).toHaveLength(2);
    expect(malformedDrafts).toHaveLength(1);
    expect(malformedDrafts[0].ordinal).toBe(1);
    expect(malformedDrafts[0].errorMessage).toMatch(
      /ordinal=1 malformed: cloze draft: invalid correctAnswer/,
    );

    // All 3 Claude calls fired (no short-circuit), and all 3 contribute to
    // token usage — including the one that produced the malformed payload.
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(tokenUsage.inputTokens).toBe(baseUsage.input_tokens * 3);
    expect(tokenUsage.outputTokens).toBe(baseUsage.output_tokens * 3);
  });

  it("accepts vocab_recall multi-word expectedWord and normalizes whitespace", async () => {
    // Regression for `.claude/bugs/vocab-recall-multi-word-rejected/`: the
    // validator used to reject any whitespace in expectedWord, which killed
    // the es-b1-environment-vocab cell every time Claude proposed `medio
    // ambiente` (a canonical positive example from that umbrella's
    // curriculum). The fix relaxes the validator to allow multi-word
    // lexemes and normalizes the stored value (trim + collapse internal
    // whitespace runs) so dedup, grading, and display all agree.
    let callIndex = 0;
    mockCreate.mockImplementation(() => {
      const idx = callIndex++;
      // Ordinal 0: messy whitespace around a multi-word lexeme — exercises
      // both the "multi-word is fine" and the normalization paths.
      const expectedWord = idx === 0 ? "  medio   ambiente " : `palabra${idx}`;
      return Promise.resolve({
        content: [
          {
            type: "tool_use",
            id: `toolu_v_${idx}`,
            name: TOOL_NAME_BY_TYPE.vocab_recall,
            input: {
              ...validVocabInput,
              prompt: `Definition ${idx}.`,
              expectedWord,
              exampleSentence: `Ejemplo ${idx} con ${expectedWord.trim()}.`,
            },
          },
        ],
        stop_reason: "tool_use",
        usage: baseUsage,
      });
    });

    const { drafts, malformedDrafts } = await generateBatch(mockClient, {
      ...baseSpec,
      exerciseType: ExerciseType.VOCAB_RECALL,
      count: 2,
    });

    expect(drafts).toHaveLength(2);
    expect(malformedDrafts).toHaveLength(0);
    expect(isVocabRecallContent(drafts[0].contentJson)).toBe(true);
    const firstContent = drafts[0].contentJson as VocabRecallContent;
    expect(firstContent.expectedWord).toBe("medio ambiente");
    const secondContent = drafts[1].contentJson as VocabRecallContent;
    expect(secondContent.expectedWord).toBe("palabra1");
  });

  it("captures vocab_recall whitespace-only expectedWord as malformed", async () => {
    // The relaxed validator still rejects whitespace-only `expectedWord`:
    // multi-word is fine, but the lexeme has to contain at least one
    // non-whitespace character.
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_v_ws",
          name: TOOL_NAME_BY_TYPE.vocab_recall,
          input: {
            ...validVocabInput,
            expectedWord: "   ",
          },
        },
      ],
      stop_reason: "tool_use",
      usage: baseUsage,
    });

    const { drafts, malformedDrafts } = await generateBatch(mockClient, {
      ...baseSpec,
      exerciseType: ExerciseType.VOCAB_RECALL,
      count: 1,
    });

    expect(drafts).toHaveLength(0);
    expect(malformedDrafts).toHaveLength(1);
    expect(malformedDrafts[0].errorMessage).toMatch(
      /ordinal=0 malformed: vocab_recall draft: invalid expectedWord: must contain non-whitespace characters/,
    );
  });

  it("returns an empty drafts array when every ordinal is malformed", async () => {
    // The cell-level orchestrator (runOneCell) decides this is a fail-closed
    // condition; generateBatch itself just reports it.
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "I cannot do that." }],
      stop_reason: "end_turn",
      usage: baseUsage,
    });

    const { drafts, malformedDrafts } = await generateBatch(mockClient, {
      ...baseSpec,
      count: 3,
    });

    expect(drafts).toHaveLength(0);
    expect(malformedDrafts).toHaveLength(3);
    expect(malformedDrafts.map((m) => m.ordinal)).toEqual([0, 1, 2]);
  });

  // ---- Within-batch behavior ----

  it("sends a byte-identical system prompt for every ordinal so prompt caching hits across the batch", async () => {
    let callIndex = 0;
    mockCreate.mockImplementation(() => {
      const idx = callIndex++;
      return Promise.resolve({
        content: [
          {
            type: "tool_use",
            id: `toolu_${idx}`,
            name: TOOL_NAME_BY_TYPE.cloze,
            input: {
              ...validClozeInput,
              sentence: `Yo ___ ejercicio número ${idx} aquí.`,
            },
          },
        ],
        stop_reason: "tool_use",
        usage: baseUsage,
      });
    });

    const { drafts } = await generateBatch(mockClient, {
      ...baseSpec,
      count: 3,
    });

    expect(drafts).toHaveLength(3);
    const systemTexts = mockCreate.mock.calls.map(
      (c) => c[0].system[0].text as string,
    );
    expect(systemTexts[0]).toBe(systemTexts[1]);
    expect(systemTexts[1]).toBe(systemTexts[2]);
    // Recent-stems hint renders "(none yet)" because intra-batch feedback is
    // dropped — this is the cache-stability guarantee.
    expect(systemTexts[0]).toContain("(none yet)");
    expect(systemTexts[2]).not.toContain("yo ___ ejercicio numero 0 aqui.");
  });

  // ---- Token aggregation ----

  it("aggregates tokenUsage across drafts (3-draft happy path)", async () => {
    const usage = {
      input_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 50,
      output_tokens: 200,
    };
    let callIndex = 0;
    mockCreate.mockImplementation(() => {
      const idx = callIndex++;
      return Promise.resolve({
        content: [
          {
            type: "tool_use",
            id: `toolu_${idx}`,
            name: TOOL_NAME_BY_TYPE.cloze,
            input: {
              ...validClozeInput,
              sentence: `Frase ${idx} con ___ aquí.`,
            },
          },
        ],
        stop_reason: "tool_use",
        usage,
      });
    });

    const { tokenUsage } = await generateBatch(mockClient, {
      ...baseSpec,
      count: 3,
    });

    expect(tokenUsage).toEqual({
      inputTokens: 300,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 150,
      outputTokens: 600,
    });
  });

  it("falls back to 0 when usage cache fields are missing", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: TOOL_NAME_BY_TYPE.cloze,
          input: validClozeInput,
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 200 },
    });

    const { tokenUsage } = await generateBatch(mockClient, baseSpec);
    expect(tokenUsage.cacheCreationInputTokens).toBe(0);
    expect(tokenUsage.cacheReadInputTokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// systemPromptOverride seam (eval-harness) — Req 2.1, 2.2
// ---------------------------------------------------------------------------

describe("generateBatch systemPromptOverride", () => {
  const mockCreate = vi.fn();
  const mockClient = {
    messages: { create: mockCreate },
  } as unknown as ReturnType<typeof createClaudeClient>;
  const buildSpy = vi.mocked(buildGenerationSystemPrompt);

  beforeEach(() => {
    mockCreate.mockReset();
    buildSpy.mockClear();
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_override",
          name: TOOL_NAME_BY_TYPE.cloze,
          input: validClozeInput,
        },
      ],
      stop_reason: "tool_use",
      usage: baseUsage,
    });
  });

  it("uses the override body verbatim as the cached system block and skips buildGenerationSystemPrompt", async () => {
    const override =
      "VERBATIM OVERRIDE SYSTEM PROMPT — must not fetch from Langfuse.";

    await generateBatch(mockClient, {
      ...baseSpec,
      systemPromptOverride: override,
    });

    // (a) the request's system[0].text is the override verbatim, still wrapped
    // with the same ephemeral cache_control the no-override path uses.
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toEqual([
      {
        type: "text",
        text: override,
        cache_control: { type: "ephemeral" },
      },
    ]);
    // and the internal builder (Langfuse fetch) was never invoked.
    expect(buildSpy).not.toHaveBeenCalled();
  });

  it("falls through to buildGenerationSystemPrompt when no override is set (unchanged behavior)", async () => {
    await generateBatch(mockClient, baseSpec);

    // (b) without an override the builder runs and its (fallback) text is used.
    expect(buildSpy).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toEqual([
      {
        type: "text",
        text: expect.any(String),
        cache_control: { type: "ephemeral" },
      },
    ]);
    expect(callArgs.system[0].text).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// sentence-construction generation tool
// ---------------------------------------------------------------------------

describe("sentence-construction generation tool", () => {
  it("registers the tool name", () => {
    expect(TOOL_NAME_BY_TYPE[ExerciseType.SENTENCE_CONSTRUCTION]).toBe(
      "submit_sentence_construction_exercise",
    );
  });
  it("maps the type to its tool, named consistently", () => {
    const tool = GENERATION_TOOL_BY_TYPE[ExerciseType.SENTENCE_CONSTRUCTION];
    expect(tool).toBe(SENTENCE_CONSTRUCTION_GENERATION_TOOL);
    expect(tool.name).toBe(TOOL_NAME_BY_TYPE[ExerciseType.SENTENCE_CONSTRUCTION]);
  });
  it("requires the core fields and declares promptMode/modelAnswers", () => {
    const schema = SENTENCE_CONSTRUCTION_GENERATION_TOOL.input_schema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.required).toEqual(
      expect.arrayContaining(["instructions", "promptMode", "prompt", "modelAnswers"]),
    );
    expect(schema.properties).toHaveProperty("keywords");
    expect(schema.properties).toHaveProperty("register");
    expect(schema.properties).toHaveProperty("targetStructure");
  });
});

// ---------------------------------------------------------------------------
// parseGeneratedSentenceConstructionDraft
// ---------------------------------------------------------------------------

describe("parseGeneratedSentenceConstructionDraft", () => {
  const spec: GenerationSpec = {
    ...baseSpec,
    exerciseType: ExerciseType.SENTENCE_CONSTRUCTION,
  };

  it("parses a valid grammar_target draft", () => {
    const out = parseGeneratedSentenceConstructionDraft(
      {
        instructions: "Write one sentence in Spanish.",
        promptMode: "grammar_target",
        prompt: "Write a sentence using the present subjunctive to express a wish.",
        targetStructure: "present subjunctive",
        modelAnswers: ["Espero que vengas.", "Ojalá llueva."],
      },
      spec,
    );
    expect(out.type).toBe(ExerciseType.SENTENCE_CONSTRUCTION);
    expect(out.promptMode).toBe("grammar_target");
    expect(out.modelAnswers).toHaveLength(2);
  });

  it("parses keywords mode with a non-empty keyword list", () => {
    const out = parseGeneratedSentenceConstructionDraft(
      {
        instructions: "Write one sentence.",
        promptMode: "keywords",
        prompt: "Use these words: ayer, biblioteca, libro.",
        keywords: ["ayer", "biblioteca", "libro"],
        modelAnswers: ["Ayer olvidé un libro en la biblioteca.", "Ayer fui a la biblioteca por un libro."],
      },
      spec,
    );
    expect(out.keywords).toEqual(["ayer", "biblioteca", "libro"]);
  });

  it("rejects keywords mode with no keywords", () => {
    expect(() =>
      parseGeneratedSentenceConstructionDraft(
        { instructions: "x", promptMode: "keywords", prompt: "p", modelAnswers: ["a", "b"] },
        spec,
      ),
    ).toThrow(/keywords/);
  });

  it("rejects an unknown promptMode", () => {
    expect(() =>
      parseGeneratedSentenceConstructionDraft(
        { instructions: "x", promptMode: "freeform", prompt: "p", modelAnswers: ["a", "b"] },
        spec,
      ),
    ).toThrow(/promptMode/);
  });

  it("rejects fewer than 2 or more than 3 model answers", () => {
    expect(() =>
      parseGeneratedSentenceConstructionDraft(
        { instructions: "x", promptMode: "situation", prompt: "p", modelAnswers: ["only one"] },
        spec,
      ),
    ).toThrow(/modelAnswers/);
  });

  it("rejects more than 3 model answers", () => {
    expect(() =>
      parseGeneratedSentenceConstructionDraft(
        { instructions: "x", promptMode: "situation", prompt: "p", modelAnswers: ["a", "b", "c", "d"] },
        spec,
      ),
    ).toThrow(/modelAnswers/);
  });

  it("drops keywords supplied outside keywords mode", () => {
    const out = parseGeneratedSentenceConstructionDraft(
      { instructions: "x", promptMode: "situation", prompt: "p", keywords: ["stray"], modelAnswers: ["a", "b"] },
      spec,
    );
    expect(out.keywords).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// generateOneDraft — dictation branch
// ---------------------------------------------------------------------------

function mockDictationClient() {
  return {
    messages: {
      create: async () => ({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            name: "submit_dictation_exercise",
            input: {
              title: "El tiempo",
              referenceText: "No te preocupes, el tiempo lo cura todo.",
              sentences: ["No te preocupes, el tiempo lo cura todo."],
              tested: ["sinalefa"],
              durationSec: 7,
              domain: "daily routine",
              register: "informal",
            },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    },
  } as never;
}

describe("generateOneDraft — dictation branch", () => {
  it("produces a dictation draft (no veto)", async () => {
    const res = await generateOneDraft(mockDictationClient(), dictSpec as never, 0);
    expect(res.kind).toBe("draft");
    if (res.kind !== "draft") return;
    expect(res.draft.contentJson.type).toBe(ExerciseType.DICTATION);
    expect(res.draft.contentJson).toMatchObject({ voiceId: "Sergio" });
  });
});

function mockFreeWritingClient() {
  return {
    messages: {
      create: async () => ({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            name: "submit_free_writing_exercise",
            input: {
              instructions: "Escribe un párrafo.",
              title: "El teletrabajo",
              task: "Da tu opinión y justifícala.",
              domain: "opinión · argumentación",
              requiredElements: [
                { id: "thesis", label: "Expón tu opinión en la primera frase." },
                { id: "reasons", label: "Da dos razones." },
              ],
              topicHint: "trabajo",
            },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    },
  } as never;
}

const fwSpec = {
  language: Language.ES,
  cefrLevel: "B2",
  exerciseType: ExerciseType.FREE_WRITING,
  grammarPoint: {
    key: "es-b2-fw-remote-work",
    kind: "free-writing",
    name: "El teletrabajo",
    description: "Opinion essay on remote work.",
    cefrLevel: "B2",
    language: Language.ES,
    examplesPositive: ["a", "b"],
    examplesNegative: ["*c"],
    commonErrors: ["d"],
    freeWriting: { register: "formal" },
  },
  topicDomain: null,
  count: 1,
  batchSeed: "test",
};

describe("generateOneDraft — free-writing branch", () => {
  it("produces a free-writing draft with code-injected register + CEFR band", async () => {
    const res = await generateOneDraft(mockFreeWritingClient(), fwSpec as never, 0);
    expect(res.kind).toBe("draft");
    if (res.kind !== "draft") return;
    expect(res.draft.contentJson.type).toBe(ExerciseType.FREE_WRITING);
    expect(res.draft.contentJson).toMatchObject({
      register: "formal",
      minWords: 150,
      maxWords: 200,
      suggestedMinutes: 25,
    });
  });
});

describe("dictation generation tool + voice pool", () => {
  it("registers a dictation generation tool", () => {
    expect(TOOL_NAME_BY_TYPE[ExerciseType.DICTATION]).toBe("submit_dictation_exercise");
    expect(GENERATION_TOOL_BY_TYPE[ExerciseType.DICTATION]).toBe(DICTATION_GENERATION_TOOL);
    expect(DICTATION_GENERATION_TOOL.name).toBe("submit_dictation_exercise");
    expect(DICTATION_GENERATION_TOOL.input_schema.required).toEqual(
      expect.arrayContaining(["title", "referenceText", "sentences", "tested", "durationSec"]),
    );
  });

  it("has a non-empty ES dictation voice pool", () => {
    expect(DICTATION_VOICE_POOL_BY_LANGUAGE[Language.ES].length).toBeGreaterThan(0);
    expect(DICTATION_VOICE_POOL_BY_LANGUAGE[Language.ES][0]).toMatchObject({
      voiceId: expect.any(String),
      accent: expect.any(String),
    });
  });

  it("has a Turkish dictation voice pool (Burcu, the only neural tr-TR voice)", () => {
    const pool = DICTATION_VOICE_POOL_BY_LANGUAGE[Language.TR];
    expect(pool.length).toBeGreaterThan(0);
    expect(pool[0].voiceId).toBe("Burcu");
  });
});

// ---------------------------------------------------------------------------
// parseGeneratedDictationDraft
// ---------------------------------------------------------------------------

const dictSpec = {
  language: Language.ES,
  cefrLevel: "B1",
  exerciseType: ExerciseType.DICTATION,
  grammarPoint: {
    key: "es-b1-dictation",
    kind: "dictation",
    name: "x",
    description: "x",
    cefrLevel: "B1",
    language: Language.ES,
    examplesPositive: ["a", "b"],
    examplesNegative: ["*c"],
    commonErrors: ["d"],
  },
  topicDomain: null,
  count: 1,
  batchSeed: "test",
} as const;

describe("parseGeneratedDictationDraft", () => {
  it("parses a dictation draft and assigns voice/accent/waveform by ordinal", () => {
    const content = parseGeneratedDictationDraft(
      {
        title: "El tiempo",
        referenceText: "No te preocupes, el tiempo lo cura todo.",
        sentences: ["No te preocupes, el tiempo lo cura todo."],
        tested: ["sinalefa"],
        durationSec: 7,
        domain: "daily routine",
        register: "informal",
      },
      dictSpec as never,
      0,
    );
    expect(content.type).toBe(ExerciseType.DICTATION);
    expect(content.referenceText).toContain("el tiempo");
    expect(content.voiceId).toBe("Sergio"); // ordinal 0 → first ES voice
    expect(content.accent).toContain("peninsular");
    expect(Array.isArray(content.waveform)).toBe(true);
    expect(content.waveform.length).toBeGreaterThan(0);
    expect(content.audioUrl).toBeUndefined(); // never set at generation time
  });

  it("assigns the Turkish voice for a TR spec", () => {
    const trSpec = {
      language: Language.TR,
      cefrLevel: "A1",
      exerciseType: ExerciseType.DICTATION,
      grammarPoint: {
        key: "tr-a1-dictation",
        kind: "dictation",
        name: "x",
        description: "x",
        cefrLevel: "A1",
        language: Language.TR,
        examplesPositive: ["a", "b"],
        examplesNegative: ["*c"],
        commonErrors: ["d"],
      },
      topicDomain: null,
      count: 1,
      batchSeed: "test",
    } as never;
    const content = parseGeneratedDictationDraft(
      {
        title: "Selam",
        referenceText: "Bugün hava güzel.",
        sentences: ["Bugün hava güzel."],
        tested: ["ünlü uyumu"],
        durationSec: 4,
      },
      trSpec,
      0,
    );
    expect(content.voiceId).toBe("Burcu");
  });

  it("rejects a dictation draft whose sentences do not join to referenceText", () => {
    expect(() =>
      parseGeneratedDictationDraft(
        { title: "t", referenceText: "A B C.", sentences: ["A B."], tested: ["x"], durationSec: 5 },
        dictSpec as never,
        0,
      ),
    ).toThrow(/sentences/);
  });

  it("accepts NFC-equivalent referenceText and sentences (precomposed vs decomposed accents)", () => {
    // Same visible text, different Unicode normalization forms:
    // referenceText uses precomposed é (U+00E9); sentences use decomposed
    // e + combining acute (U+0301). The integrity check must NFC-normalize so
    // these compare equal rather than spuriously rejecting the draft.
    const precomposed = "El café está aquí."; // U+00E9 in "café"
    const decomposed = "El café está aquí.".normalize("NFD"); // e + combining marks
    expect(precomposed).not.toBe(decomposed); // byte-different
    expect(precomposed.normalize("NFC")).toBe(decomposed.normalize("NFC")); // canonically equal

    const content = parseGeneratedDictationDraft(
      {
        title: "El café",
        referenceText: precomposed,
        sentences: [decomposed],
        tested: ["acentos"],
        durationSec: 5,
      },
      dictSpec as never,
      0,
    );
    expect(content.type).toBe(ExerciseType.DICTATION);
    expect(content.referenceText).toBe(precomposed);
  });
});

describe("parseGeneratedFreeWritingDraft", () => {
  const TOPIC = {
    key: "es-b2-fw-remote-work",
    kind: "free-writing" as const,
    name: "El teletrabajo",
    description: "Opinion essay on remote work.",
    cefrLevel: CefrLevel.B2,
    language: Language.ES,
    examplesPositive: ["a", "b"],
    examplesNegative: ["*c"],
    commonErrors: ["d"],
    freeWriting: { register: "formal" as const },
  };
  const spec: GenerationSpec = {
    language: Language.ES,
    cefrLevel: CefrLevel.B2,
    exerciseType: ExerciseType.FREE_WRITING,
    grammarPoint: TOPIC,
    topicDomain: null,
    count: 1,
    batchSeed: "test",
  };
  const validInput = {
    instructions: "Escribe un párrafo.",
    title: "El teletrabajo: ¿avance o aislamiento?",
    task: "Da tu opinión sobre el teletrabajo y justifícala con dos razones.",
    domain: "opinión · argumentación",
    requiredElements: [
      { id: "thesis", label: "Expón tu opinión en la primera frase." },
      { id: "reasons", label: "Da dos razones.", detail: "una a favor, una en contra" },
    ],
    topicHint: "trabajo",
  };

  it("injects register + CEFR band and keeps model-authored fields", () => {
    const content = parseGeneratedFreeWritingDraft(validInput, spec);
    expect(content.type).toBe(ExerciseType.FREE_WRITING);
    expect(content.register).toBe("formal");
    expect(content.minWords).toBe(150);
    expect(content.maxWords).toBe(200);
    expect(content.suggestedMinutes).toBe(25);
    expect(content.title).toBe(validInput.title);
    expect(content.requiredElements).toHaveLength(2);
    expect(content.requiredElements[1].detail).toBe("una a favor, una en contra");
    expect(content.topicHint).toBe("trabajo");
  });

  it("rejects an empty requiredElements list", () => {
    expect(() =>
      parseGeneratedFreeWritingDraft({ ...validInput, requiredElements: [] }, spec),
    ).toThrow(/requiredElements/);
  });

  it("rejects a required element missing its label", () => {
    expect(() =>
      parseGeneratedFreeWritingDraft(
        { ...validInput, requiredElements: [{ id: "x" }] },
        spec,
      ),
    ).toThrow(/label/);
  });

  it("throws when the topic entry has no register", () => {
    const noReg = { ...spec, grammarPoint: { ...TOPIC, freeWriting: undefined } };
    expect(() => parseGeneratedFreeWritingDraft(validInput, noReg)).toThrow(/register/);
  });
});

// ---------------------------------------------------------------------------
// parseGeneratedConjugationDraft
// ---------------------------------------------------------------------------

describe("parseGeneratedConjugationDraft", () => {
  const VALID = {
    instructions: "Write the correct form.",
    lemma: "ir",
    lemmaGloss: "to go",
    featureBundle: "condicional · 1ª pers. plural",
    features: [{ term: "condicional", gloss: "conditional" }],
    subject: { pronoun: "nosotros", gloss: "we" },
    targetForm: "iríamos",
    breakdown: "ir- + -íamos",
    exampleSentences: ["Iríamos al cine."],
  };

  it("parses a conjugation draft (trims targetForm)", () => {
    const out = parseGeneratedConjugationDraft(
      { ...VALID, targetForm: " iríamos ", acceptableForms: ["nos iríamos"] },
      {} as never,
    );
    expect(out.type).toBe(ExerciseType.CONJUGATION);
    expect(out.targetForm).toBe("iríamos");
    expect(out.lemma).toBe("ir");
    expect(out.acceptableForms).toEqual(["nos iríamos"]);
  });

  it("parses features and subject", () => {
    const out = parseGeneratedConjugationDraft(
      {
        ...VALID,
        features: [
          { term: "geçmiş zaman", gloss: "past" },
          { term: "olumlu", gloss: "affirmative" },
        ],
        subject: { pronoun: "o", gloss: "he / she / it" },
      },
      {} as never,
    );
    expect(out.features).toEqual([
      { term: "geçmiş zaman", gloss: "past" },
      { term: "olumlu", gloss: "affirmative" },
    ]);
    expect(out.subject).toEqual({ pronoun: "o", gloss: "he / she / it" });
  });

  it("rejects an empty target form", () => {
    expect(() =>
      parseGeneratedConjugationDraft({ ...VALID, targetForm: "  " }, {} as never),
    ).toThrow(/targetForm/);
  });

  it("rejects a whitespace-only lemma", () => {
    expect(() =>
      parseGeneratedConjugationDraft({ ...VALID, lemma: "   " }, {} as never),
    ).toThrow(/lemma/);
  });

  it("rejects empty exampleSentences", () => {
    expect(() =>
      parseGeneratedConjugationDraft({ ...VALID, exampleSentences: [] }, {} as never),
    ).toThrow(/exampleSentences/);
  });

  it("rejects an empty features array", () => {
    expect(() =>
      parseGeneratedConjugationDraft({ ...VALID, features: [] }, {} as never),
    ).toThrow(/features/);
  });

  it("rejects a feature missing its gloss", () => {
    expect(() =>
      parseGeneratedConjugationDraft(
        { ...VALID, features: [{ term: "condicional" }] },
        {} as never,
      ),
    ).toThrow(/features/);
  });

  it("rejects a subject missing its pronoun", () => {
    expect(() =>
      parseGeneratedConjugationDraft(
        { ...VALID, subject: { gloss: "we" } },
        {} as never,
      ),
    ).toThrow(/subject/);
  });

  it("registers conjugation in the tool maps", () => {
    expect(TOOL_NAME_BY_TYPE[ExerciseType.CONJUGATION]).toBe("submit_conjugation_exercise");
    expect(GENERATION_TOOL_BY_TYPE[ExerciseType.CONJUGATION].name).toBe("submit_conjugation_exercise");
  });

  it("accepts a subjectless nominal draft (case form, no person)", () => {
    const { subject: _omit, ...noSubject } = VALID;
    const out = parseGeneratedConjugationDraft(
      {
        ...noSubject,
        lemma: "ev",
        lemmaGloss: "house",
        featureBundle: "bulunma · tekil",
        features: [
          { term: "bulunma", gloss: "locative" },
          { term: "tekil", gloss: "singular" },
        ],
        targetForm: "evde",
        breakdown: "ev + -de (locative)",
        exampleSentences: ["Ali evde."],
      },
      {} as never,
    );
    expect(out.subject).toBeUndefined();
    expect(out.features).toHaveLength(2);
  });
});
