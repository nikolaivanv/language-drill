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
  GENERATION_MODEL,
  GENERATION_TEMPERATURE,
  TOOL_NAME_BY_TYPE,
  TRANSLATION_GENERATION_TOOL,
  VOCAB_RECALL_GENERATION_TOOL,
  exerciseDraftId,
  generateBatch,
  type GenerationSpec,
} from "./generate.js";

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
    expect(GENERATION_MODEL).toBe("claude-sonnet-4-5");
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
      exerciseType: "sentence_construction" as ExerciseType,
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
