import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CefrLevel, Language } from "@language-drill/shared";
import {
  annotateSpan,
  buildSpanUserPrompt,
  parseSpanResult,
  pickSpanTool,
  READ_SPAN_PHRASE_TOOL,
  READ_SPAN_PROMPT_VERSION,
  READ_SPAN_SENTENCE_TOOL,
  READ_SPAN_SYSTEM_PROMPT,
  READ_SPAN_TOOL_NAME,
  READ_SPAN_WORD_TOOL,
  ReadSpanStreamMaxTokensError,
  streamSpan,
  type ReadSpanStreamEvent,
} from "./read-span.js";
import type Anthropic from "@anthropic-ai/sdk";
import { createClaudeClient } from "./index.js";
import {
  __resetForTests as __resetObservabilityForTests,
  getCurrentLlmTraceContext,
  withLlmTrace,
  type LlmTraceContext,
} from "./observability.js";
import { __resetRegistryForTests } from "./prompts-registry.js";

// ---------------------------------------------------------------------------
// Fixtures — one valid card per `DeepCard` shape
// ---------------------------------------------------------------------------

// A fully-populated Turkish word card: exercises every optional section,
// including the morphology breakdown (the Req 7 standout).
const validWordCard = {
  type: "word",
  surface: "evlerinden",
  lemma: "ev",
  pos: "noun",
  contextualSense: "from their houses",
  definition: "Bir ailenin yaşadığı, içinde oturulan yapı.",
  definitionLabel: "Türkçe",
  cefr: "B1",
  freq: 4200,
  inflection: {
    forms: [
      { label: "root", value: "ev" },
      { label: "plural", value: "evler" },
    ],
  },
  morphology: {
    root: "ev",
    rootGloss: "house",
    segments: [
      { morph: "ev", function: "root (house)" },
      { morph: "-ler", function: "plural" },
      { morph: "-i", function: "3rd-person possessive" },
      { morph: "-n", function: "buffer consonant" },
      { morph: "-den", function: "ablative case" },
    ],
    whyThisForm:
      "Ablative (-den) because the verb 'çıktılar' expresses motion away from the houses.",
  },
  synonyms: [{ word: "konut", note: "more formal/official" }],
  collocations: [{ phrase: "evden çıkmak", gloss: "to leave the house" }],
  register: "neutral",
  extraExample: {
    tl: "Akşam geç saatte evlerinden ayrıldılar.",
    en: "They left their houses late in the evening.",
  },
} as const;

// Minimal word card — required fields only, every optional omitted.
const minimalWordCard = {
  type: "word",
  surface: "evler",
  lemma: "ev",
  pos: "noun",
  contextualSense: "houses",
  definition: "İnsanların yaşadığı yapılar.",
  definitionLabel: "Türkçe",
  cefr: "A1",
  freq: 800,
} as const;

const validPhraseCard = {
  type: "phrase",
  surface: "echar de menos",
  citation: "echar de menos",
  literal: "to throw of less",
  idiomaticMeaning: "to miss (someone or something)",
  register: "neutral",
  example: { tl: "Echo de menos a mi familia.", en: "I miss my family." },
  synonyms: [{ phrase: "extrañar", note: "Latin America" }],
} as const;

const validSentenceCard = {
  type: "sentence",
  surface: "Aunque estaba cansado, siguió trabajando hasta el amanecer.",
  translation: "Even though he was tired, he kept working until dawn.",
  breakdown: [
    {
      chunk: "Aunque estaba cansado",
      role: "subordinate clause",
      note: "concessive 'aunque' + imperfect for a background state",
    },
    {
      chunk: "siguió trabajando",
      role: "main verb",
      note: "seguir + gerund = 'to keep doing'",
    },
    { chunk: "hasta el amanecer", role: "time complement", note: "'until dawn'" },
  ],
  grammarNotes: ["Concessive clauses with 'aunque'", "seguir + gerundio"],
} as const;

const trPassage = "Çocuklar evlerinden erkenden çıktılar.";
const spanStart = trPassage.indexOf("evlerinden");
const spanEnd = spanStart + "evlerinden".length;

// ---------------------------------------------------------------------------
// Langfuse env helpers — keep the registry on its fallback path so the
// resolved system text is the in-repo prompt regardless of shell state.
// ---------------------------------------------------------------------------

const LANGFUSE_ENV_KEYS = [
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_BASE_URL",
] as const;

function snapshotAndClearLangfuseEnv(): Map<string, string | undefined> {
  const snapshot = new Map<string, string | undefined>();
  for (const k of LANGFUSE_ENV_KEYS) {
    snapshot.set(k, process.env[k]);
    delete process.env[k];
  }
  return snapshot;
}

function restoreLangfuseEnv(snapshot: Map<string, string | undefined>): void {
  for (const k of LANGFUSE_ENV_KEYS) {
    const v = snapshot.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// ---------------------------------------------------------------------------
// Span tools / prompt sanity
// ---------------------------------------------------------------------------
// Anthropic's tool-use API rejects `oneOf` / `allOf` / `anyOf` at the top
// level of `input_schema` with a 400; the original single `READ_SPAN_TOOL`
// triggered that in prod. The caller picks the exact-shape tool per call
// via `pickSpanTool(spanType)`, keeping the union an internal client concept.

const SPAN_TOOLS = [
  READ_SPAN_WORD_TOOL,
  READ_SPAN_PHRASE_TOOL,
  READ_SPAN_SENTENCE_TOOL,
] as const;

describe("span tools", () => {
  it("share the constant tool name so the system prompt stays valid", () => {
    expect(READ_SPAN_TOOL_NAME).toBe("submit_deep_card");
    for (const tool of SPAN_TOOLS) {
      expect(tool.name).toBe("submit_deep_card");
    }
  });

  // Regression guard for the prod 502: Anthropic's API rejects top-level
  // `oneOf`/`allOf`/`anyOf` on `input_schema`. Each per-shape tool must be a
  // flat object schema.
  it("each tool's input_schema is a flat object — no top-level oneOf/allOf/anyOf", () => {
    for (const tool of SPAN_TOOLS) {
      const schema = tool.input_schema as Record<string, unknown>;
      expect(schema.type).toBe("object");
      expect(schema.oneOf).toBeUndefined();
      expect(schema.allOf).toBeUndefined();
      expect(schema.anyOf).toBeUndefined();
      expect(schema.properties).toBeDefined();
    }
  });

  it("`pickSpanTool` returns the matching per-shape tool", () => {
    expect(pickSpanTool("word")).toBe(READ_SPAN_WORD_TOOL);
    expect(pickSpanTool("phrase")).toBe(READ_SPAN_PHRASE_TOOL);
    expect(pickSpanTool("sentence")).toBe(READ_SPAN_SENTENCE_TOOL);
  });

  it("each tool forces the matching `type` literal in its required list", () => {
    const word = READ_SPAN_WORD_TOOL.input_schema as {
      properties: { type: { enum: string[] } };
      required: string[];
    };
    expect(word.properties.type.enum).toEqual(["word"]);
    expect(word.required).toContain("type");
    // The base English gloss is always required of the model so manually
    // selected (non-flagged) words — which have no skim gloss to borrow —
    // still get a short meaning on the card.
    expect(word.required).toContain("baseGloss");

    const phrase = READ_SPAN_PHRASE_TOOL.input_schema as {
      properties: { type: { enum: string[] } };
    };
    expect(phrase.properties.type.enum).toEqual(["phrase"]);

    const sentence = READ_SPAN_SENTENCE_TOOL.input_schema as {
      properties: { type: { enum: string[] } };
    };
    expect(sentence.properties.type.enum).toEqual(["sentence"]);
  });
});

describe("READ_SPAN_SYSTEM_PROMPT", () => {
  it("instructs the model that the caller decides the card type", () => {
    expect(READ_SPAN_SYSTEM_PROMPT).toContain("caller decides the card type");
  });

  it("requires the tool call (no plain-text replies)", () => {
    expect(READ_SPAN_SYSTEM_PROMPT).toContain(READ_SPAN_TOOL_NAME);
    expect(READ_SPAN_SYSTEM_PROMPT).toMatch(/MUST call/i);
  });

  it("pins the version constant", () => {
    expect(READ_SPAN_PROMPT_VERSION).toBe("read-span@2026-07-13");
  });

  it("documents the base English gloss for word cards", () => {
    expect(READ_SPAN_SYSTEM_PROMPT).toMatch(/baseGloss/);
  });

  it("carries per-language morphology guidance for Turkish and German (Req 7)", () => {
    expect(READ_SPAN_SYSTEM_PROMPT).toContain("Morphology by language");
    // Turkish: morpheme segmentation + sentence-grounded "why this form".
    expect(READ_SPAN_SYSTEM_PROMPT).toMatch(/agglutinative/i);
    expect(READ_SPAN_SYSTEM_PROMPT).toMatch(/ablative/i);
    // German: case + separable-prefix guidance.
    expect(READ_SPAN_SYSTEM_PROMPT).toMatch(/separable/i);
    expect(READ_SPAN_SYSTEM_PROMPT).toMatch(/dative/i);
  });
});

// ---------------------------------------------------------------------------
// parseSpanResult — Req 6.1 (accepts each card type; rejects malformed)
// ---------------------------------------------------------------------------

describe("parseSpanResult", () => {
  it("accepts a fully-populated word card", () => {
    const card = parseSpanResult(validWordCard);
    expect(card.type).toBe("word");
    if (card.type === "word") {
      expect(card.surface).toBe("evlerinden");
      expect(card.morphology?.segments).toHaveLength(5);
      expect(card.morphology?.whyThisForm).toContain("Ablative");
    }
  });

  it("accepts a minimal word card with every optional omitted", () => {
    const card = parseSpanResult(minimalWordCard);
    expect(card.type).toBe("word");
    if (card.type === "word") {
      expect(card.inflection).toBeUndefined();
      expect(card.morphology).toBeUndefined();
      expect(card.synonyms).toBeUndefined();
    }
  });

  it("accepts a phrase card", () => {
    const card = parseSpanResult(validPhraseCard);
    expect(card.type).toBe("phrase");
    if (card.type === "phrase") {
      expect(card.idiomaticMeaning).toContain("to miss");
      expect(card.literal).toBe("to throw of less");
    }
  });

  it("accepts a sentence card", () => {
    const card = parseSpanResult(validSentenceCard);
    expect(card.type).toBe("sentence");
    if (card.type === "sentence") {
      expect(card.breakdown).toHaveLength(3);
      expect(card.grammarNotes.length).toBeGreaterThan(0);
    }
  });

  it("rejects a card with no `type` discriminant", () => {
    const { type: _omit, ...noType } = validWordCard;
    expect(() => parseSpanResult(noType)).toThrow();
  });

  it("rejects an unknown card type", () => {
    expect(() => parseSpanResult({ ...validWordCard, type: "paragraph" })).toThrow();
  });

  it("rejects a word card missing a required field", () => {
    const { lemma: _omit, ...noLemma } = validWordCard;
    expect(() => parseSpanResult(noLemma)).toThrow();
  });

  it("rejects a word card with a wrong-typed field", () => {
    expect(() => parseSpanResult({ ...validWordCard, freq: "lots" })).toThrow();
  });

  it("rejects a phrase card missing its idiomatic meaning", () => {
    const { idiomaticMeaning: _omit, ...broken } = validPhraseCard;
    expect(() => parseSpanResult(broken)).toThrow();
  });

  it("rejects non-object input", () => {
    expect(() => parseSpanResult("nope")).toThrow();
    expect(() => parseSpanResult(null)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Morphology contract — Req 7.1 (Turkish segmentation), 7.2 (German case /
// separable prefix), 7.3 (sentence-grounded `whyThisForm`).
// ---------------------------------------------------------------------------
// The schema fields exist from task 1; these assertions pin the contract the
// task-30 prompt is meant to elicit. Each segment must carry both a `morph`
// and a `function` label, and `whyThisForm` must cite the in-sentence trigger
// (not a generic rule). A card without morphology must still validate, since
// the field is optional and only emitted when the word has informative
// internal structure.
// ---------------------------------------------------------------------------

// A German separable-prefix card mirroring the prompt's one-shot — pins the
// Req 7.2 contract for the German path (alongside the Turkish fixture above).
const germanSeparableCard = {
  type: "word",
  surface: "vor",
  lemma: "vorstellen",
  pos: "verb",
  contextualSense: "introduce (separable prefix)",
  definition: "Jemandem eine andere Person bekannt machen.",
  definitionLabel: "Deutsch",
  cefr: "B1",
  freq: 2500,
  morphology: {
    root: "vorstellen",
    rootGloss: "to introduce",
    segments: [
      { morph: "stellte", function: "conjugated stem (3sg past)" },
      { morph: "vor", function: "separable prefix" },
    ],
    whyThisForm:
      "'vorstellen' is a separable verb; in a main clause the prefix 'vor' detaches and moves to the end of the clause.",
  },
} as const;

describe("morphology — populated breakdowns + sentence-grounded whyThisForm (Req 7)", () => {
  it("parses a Turkish word card with morpheme segments labelled by function (Req 7.1)", () => {
    const card = parseSpanResult(validWordCard);
    if (card.type !== "word") throw new Error("expected word card");
    expect(card.morphology).toBeDefined();
    const { root, rootGloss, segments } = card.morphology!;
    expect(root).toBe("ev");
    expect(rootGloss).toBe("house");

    // Every segment carries BOTH a surface morph and a function label.
    for (const seg of segments) {
      expect(seg.morph.length).toBeGreaterThan(0);
      expect(seg.function.length).toBeGreaterThan(0);
    }
    // The agglutinated pieces are present, each tagged with its grammatical role.
    expect(segments.map((s) => s.morph)).toEqual(
      expect.arrayContaining(["ev", "-ler", "-i", "-den"]),
    );
    expect(segments.map((s) => s.function)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/root/i),
        expect.stringMatching(/plural/i),
        expect.stringMatching(/possess/i),
        expect.stringMatching(/ablative/i),
      ]),
    );
  });

  it("Turkish whyThisForm cites the in-sentence trigger, not a generic rule (Req 7.3)", () => {
    const card = parseSpanResult(validWordCard);
    if (card.type !== "word") throw new Error("expected word card");
    // The fixture's reasoning names the governing verb from the passage —
    // i.e. it's grounded in the sentence, not a standalone rule statement.
    expect(card.morphology?.whyThisForm).toMatch(/çıktılar/);
  });

  it("parses a German word card with a separable-prefix breakdown (Req 7.2)", () => {
    const card = parseSpanResult(germanSeparableCard);
    if (card.type !== "word") throw new Error("expected word card");
    expect(card.morphology).toBeDefined();
    const segments = card.morphology!.segments;
    expect(segments).toHaveLength(2);
    expect(
      segments.find((s) => /separable/i.test(s.function)),
    ).toBeDefined();
    // German Req 7.3: whyThisForm names the syntactic trigger (separable verb
    // / main-clause rule) rather than just defining the word.
    expect(card.morphology?.whyThisForm).toMatch(/separable verb|main clause/i);
  });

  it("a word card without morphology still validates (Req 7 optionality)", () => {
    const card = parseSpanResult(minimalWordCard);
    if (card.type !== "word") throw new Error("expected word card");
    expect(card.morphology).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildSpanUserPrompt
// ---------------------------------------------------------------------------

describe("buildSpanUserPrompt", () => {
  it("includes the language, CEFR level, requested card type, span, and full passage", () => {
    const prompt = buildSpanUserPrompt({
      language: Language.TR,
      text: trPassage,
      start: spanStart,
      end: spanEnd,
      spanType: "word",
      proficiencyLevel: CefrLevel.B1,
    });

    expect(prompt).toContain("TR");
    expect(prompt).toContain("B1");
    expect(prompt).toContain("word");
    expect(prompt).toContain("evlerinden");
    expect(prompt).toContain(trPassage);
  });
});

// ---------------------------------------------------------------------------
// annotateSpan — mocked SDK (Req 6.1 — forced tool call → DeepCard)
// ---------------------------------------------------------------------------

describe("annotateSpan", () => {
  const mockCreate = vi.fn();
  const mockClient = {
    messages: { create: mockCreate },
  } as unknown as ReturnType<typeof createClaudeClient>;

  let envSnapshot: Map<string, string | undefined>;

  const wordInput = {
    language: Language.TR,
    text: trPassage,
    start: spanStart,
    end: spanEnd,
    spanType: "word" as const,
    proficiencyLevel: CefrLevel.B1,
  };

  beforeEach(() => {
    envSnapshot = snapshotAndClearLangfuseEnv();
    mockCreate.mockReset();
    __resetRegistryForTests();
    __resetObservabilityForTests();
  });

  afterEach(() => {
    restoreLangfuseEnv(envSnapshot);
    __resetRegistryForTests();
    __resetObservabilityForTests();
  });

  it("calls Sonnet with a forced tool choice and returns the parsed card", async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: "tool_use", id: "toolu_w", name: READ_SPAN_TOOL_NAME, input: validWordCard },
      ],
      stop_reason: "tool_use",
    });

    const card = await annotateSpan(mockClient, wordInput);

    expect(card.type).toBe("word");
    if (card.type === "word") expect(card.surface).toBe("evlerinden");

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe("claude-sonnet-4-6");
    expect(callArgs.temperature).toBe(0);
    expect(callArgs.tools).toHaveLength(1);
    expect(callArgs.tools[0].name).toBe(READ_SPAN_TOOL_NAME);
    expect(callArgs.tool_choice).toEqual({ type: "tool", name: READ_SPAN_TOOL_NAME });

    // Fallback path (Langfuse unset) → system text is the in-repo prompt,
    // cached with cache_control: ephemeral (mirrors evaluate.ts).
    expect(callArgs.system).toEqual([
      { type: "text", text: READ_SPAN_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ]);

    // The requested span type is threaded into the user prompt.
    expect(callArgs.messages[0].content).toContain("word");
    expect(callArgs.messages[0].content).toContain("evlerinden");
  });

  it("returns a phrase card when the phrase shape is produced", async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: "tool_use", id: "toolu_p", name: READ_SPAN_TOOL_NAME, input: validPhraseCard },
      ],
      stop_reason: "tool_use",
    });

    const card = await annotateSpan(mockClient, { ...wordInput, spanType: "phrase" });
    expect(card.type).toBe("phrase");
  });

  it("throws when Claude returns no tool_use block", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "I cannot annotate this." }],
      stop_reason: "end_turn",
    });

    await expect(annotateSpan(mockClient, wordInput)).rejects.toThrow(
      "Claude did not return a tool use block",
    );
  });

  it("throws when Claude returns the wrong tool name", async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: "tool_use", id: "toolu_x", name: "some_other_tool", input: validWordCard },
      ],
      stop_reason: "tool_use",
    });

    await expect(annotateSpan(mockClient, wordInput)).rejects.toThrow("Unexpected tool name");
  });

  it("throws when the tool input fails DeepCard validation", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_bad",
          name: READ_SPAN_TOOL_NAME,
          input: { type: "word", surface: "evler" }, // missing required fields
        },
      ],
      stop_reason: "tool_use",
    });

    await expect(annotateSpan(mockClient, wordInput)).rejects.toThrow();
  });

  it("propagates SDK errors", async () => {
    mockCreate.mockRejectedValue(new Error("API overloaded"));
    await expect(annotateSpan(mockClient, wordInput)).rejects.toThrow("API overloaded");
  });
});

// ---------------------------------------------------------------------------
// annotateSpan + prompts-registry — fallback cohort tag when Langfuse unset
// ---------------------------------------------------------------------------

describe("annotateSpan + prompts-registry", () => {
  const mockCreate = vi.fn();
  const mockClient = {
    messages: { create: mockCreate },
  } as unknown as ReturnType<typeof createClaudeClient>;

  let envSnapshot: Map<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotAndClearLangfuseEnv();
    mockCreate.mockReset();
    __resetRegistryForTests();
    __resetObservabilityForTests();
  });

  afterEach(() => {
    restoreLangfuseEnv(envSnapshot);
    __resetRegistryForTests();
    __resetObservabilityForTests();
  });

  function baseCtx(): LlmTraceContext {
    return {
      // "annotate" is the closest existing LlmFeature; the route (task 17)
      // owns the trace feature. The feature value is irrelevant here — this
      // test asserts the prompt-version stamping done by getPromptOrFallback.
      feature: "annotate",
      env: "dev",
      promptVersion: "pending",
      requestId: "test-request-001",
      userId: "dev_user_001",
      language: Language.TR,
      cefrLevel: CefrLevel.B1,
    };
  }

  it("stamps `fallback:<version>` on the trace when Langfuse is unset", async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: "tool_use", id: "toolu_fb", name: READ_SPAN_TOOL_NAME, input: validWordCard },
      ],
      stop_reason: "tool_use",
    });

    await withLlmTrace(baseCtx(), async () => {
      await annotateSpan(mockClient, {
        language: Language.TR,
        text: trPassage,
        start: spanStart,
        end: spanEnd,
        spanType: "word",
        proficiencyLevel: CefrLevel.B1,
      });
      const ctx = getCurrentLlmTraceContext();
      expect(ctx?.promptVersion).toBe(`fallback:${READ_SPAN_PROMPT_VERSION}`);
      expect(ctx?.promptFallback).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// streamSpan — mocked streaming SDK (Req 1.1, 1.3, 1.4, 1.5)
// ---------------------------------------------------------------------------

/**
 * Minimal stand-in for `client.messages.stream(...)`: an async-iterable of
 * `input_json_delta` events plus a `finalMessage()` that returns the assembled
 * tool_use block (the authoritative card source). Mirrors `fakeStream` in
 * annotate-stream.test.ts but carries `content` so `streamSpan` can extract +
 * validate the final card.
 */
function fakeSpanStream(
  deltas: ReadonlyArray<string>,
  opts: {
    stopReason?: "tool_use" | "end_turn" | "max_tokens";
    cardInput?: unknown;
    content?: unknown[];
    abortSignal?: AbortSignal;
  } = {},
) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const partial_json of deltas) {
        if (opts.abortSignal?.aborted) {
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        }
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json },
        };
      }
    },
    finalMessage: async () => ({
      stop_reason: opts.stopReason ?? "tool_use",
      content:
        opts.content ??
        [
          {
            type: "tool_use",
            id: "toolu_s",
            name: READ_SPAN_TOOL_NAME,
            input: opts.cardInput,
          },
        ],
    }),
  };
}

async function collectSpan(
  iterable: AsyncIterable<ReadSpanStreamEvent>,
): Promise<ReadSpanStreamEvent[]> {
  const events: ReadSpanStreamEvent[] = [];
  for await (const ev of iterable) events.push(ev);
  return events;
}

describe("streamSpan", () => {
  let envSnapshot: Map<string, string | undefined>;

  const wordInput = {
    language: Language.TR,
    text: trPassage,
    start: spanStart,
    end: spanEnd,
    spanType: "word" as const,
    proficiencyLevel: CefrLevel.B1,
  };

  beforeEach(() => {
    envSnapshot = snapshotAndClearLangfuseEnv();
    __resetRegistryForTests();
    __resetObservabilityForTests();
  });

  afterEach(() => {
    restoreLangfuseEnv(envSnapshot);
    __resetRegistryForTests();
    __resetObservabilityForTests();
  });

  it("streams each top-level field then a done with the validated card", async () => {
    const fullJson = JSON.stringify(minimalWordCard);
    const split = Math.floor(fullJson.length / 2);
    const deltas = [fullJson.slice(0, split), fullJson.slice(split)];

    const stream = fakeSpanStream(deltas, { cardInput: minimalWordCard });
    const client = {
      messages: { stream: vi.fn(() => stream) },
    } as unknown as Anthropic;

    const events = await collectSpan(streamSpan(client, wordInput));

    // Every top-level key of the card streams as a `field`, in order…
    const fieldKeys = events
      .filter((e): e is Extract<ReadSpanStreamEvent, { kind: "field" }> => e.kind === "field")
      .map((e) => e.key);
    expect(fieldKeys).toEqual(Object.keys(minimalWordCard));

    // …followed by exactly one terminal `done` carrying the parsed card.
    const last = events[events.length - 1];
    expect(last.kind).toBe("done");
    if (last.kind === "done") {
      expect(last.card).toEqual(parseSpanResult(minimalWordCard));
    }
    // Only one done, and it is last.
    expect(events.filter((e) => e.kind === "done")).toHaveLength(1);

    // Streamed with maxRetries:1 and no client timeout (Req 4.2).
    const streamFn = (client.messages as unknown as { stream: ReturnType<typeof vi.fn> }).stream;
    expect(streamFn.mock.calls[0][1]).toMatchObject({ maxRetries: 1 });
    expect(streamFn.mock.calls[0][1]).not.toHaveProperty("timeout");
  });

  it("throws ReadSpanStreamMaxTokensError on stop_reason: max_tokens", async () => {
    // A truncated buffer (open object) + max_tokens stop.
    const stream = fakeSpanStream(['{"type":"word"'], { stopReason: "max_tokens" });
    const client = {
      messages: { stream: vi.fn(() => stream) },
    } as unknown as Anthropic;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(collectSpan(streamSpan(client, wordInput))).rejects.toBeInstanceOf(
        ReadSpanStreamMaxTokensError,
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("ends without `done` when the AbortSignal fires mid-stream", async () => {
    const fullJson = JSON.stringify(minimalWordCard);
    // First delta completes exactly one field (`"type":"word",`), so the first
    // pull yields one `field`; the second pull pumps the stream and aborts.
    const firstFieldEnd = fullJson.indexOf(",") + 1;
    const deltas = [fullJson.slice(0, firstFieldEnd), fullJson.slice(firstFieldEnd)];

    const controller = new AbortController();
    const stream = fakeSpanStream(deltas, {
      cardInput: minimalWordCard,
      abortSignal: controller.signal,
    });
    const client = {
      messages: { stream: vi.fn(() => stream) },
    } as unknown as Anthropic;

    const iterator = streamSpan(client, {
      ...wordInput,
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({ kind: "field", key: "type", value: "word" });

    controller.abort();

    // The next pull pumps the mock iterator, which throws AbortError — the
    // generator never reaches `yield done`.
    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
  });
});
