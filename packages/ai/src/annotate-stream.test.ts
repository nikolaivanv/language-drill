import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CefrLevel, Language } from "@language-drill/shared";

import {
  ANNOTATE_SYSTEM_PROMPT,
  ANNOTATE_SYSTEM_PROMPT_VERSION,
  AnnotateStreamMaxTokensError,
  buildAnnotateUserPrompt,
  extractNewItems,
  streamAnnotation,
  type AnnotateStreamEvent,
  type AnnotateStreamInput,
} from "./annotate";
import {
  __resetForTests as __resetObservabilityForTests,
  getCurrentLlmTraceContext,
  withLlmTrace,
  type LlmTraceContext,
} from "./observability";
import { __resetRegistryForTests, sha8 } from "./prompts-registry";

// ---------------------------------------------------------------------------
// Contract tests for the streaming-JSON-array helper used by
// `streamAnnotation` (task 13) AND for the rewritten enrichment-only user
// prompt builder. Both are load-bearing primitives: a regression in
// `extractNewItems` corrupts the `flag` events the Lambda forwards to the
// browser; a regression in `buildAnnotateUserPrompt` changes what Claude
// sees and therefore what it returns. Each case below mirrors a case
// enumerated in tasks.md task 11.
// ---------------------------------------------------------------------------

describe("extractNewItems", () => {
  // ── (a) single complete item arrives in one buffer chunk ──────────────────
  it("returns one item when a complete element arrives in one chunk", () => {
    const buffer =
      '{"flagged":[{"matchedForm":"casa","lemma":"casa","pos":"noun","gloss":"house","example":"Vivo en una casa.","freq":1234,"cefr":"A2"}]}';

    const items = extractNewItems(buffer, 0);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      matchedForm: "casa",
      lemma: "casa",
      pos: "noun",
      gloss: "house",
      cefr: "A2",
    });
  });

  // ── (b) item split across two chunks ──────────────────────────────────────
  it("returns nothing on a partial buffer, then the item once it closes", () => {
    // First chunk: object isn't closed.
    const partial = '{"flagged":[{"matchedForm":"casa","lemma":"cas';
    expect(extractNewItems(partial, 0)).toEqual([]);

    // Subsequent chunk completes the same object — the caller passes the full
    // accumulated buffer and `alreadyYielded: 0` (nothing emitted yet).
    const completed =
      '{"flagged":[{"matchedForm":"casa","lemma":"casa","pos":"noun","gloss":"house","example":"x","freq":1,"cefr":"A2"}]}';
    const items = extractNewItems(completed, 0);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ matchedForm: "casa", lemma: "casa" });
  });

  // ── (c) escaped `\"` inside the example string mid-chunk ──────────────────
  it("does not terminate a string early on escaped quotes", () => {
    // The `example` value contains `He said \"hi\".` — a naive string-tracker
    // would close the string at the first `"` after `said `, then choke on
    // the following bytes. The depth-aware tracker must consume the escaped
    // quote as data and stay in the string.
    const buffer =
      '{"flagged":[{"matchedForm":"casa","example":"He said \\"hi\\".","lemma":"casa"}]}';

    const items = extractNewItems(buffer, 0);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      matchedForm: "casa",
      example: 'He said "hi".',
      lemma: "casa",
    });
  });

  // ── (d) deeply nested structures (defensive — none in our schema today) ──
  it("handles arbitrary nesting inside an item without confusing depth", () => {
    // `WordFlagSchema` does not currently include nested object values, but
    // the parser must not break if Claude (or a future schema revision) emits
    // them. Brace depth counting alone must close the top-level item only
    // when the OUTER object closes, not at any inner `}`.
    const buffer =
      '{"flagged":[{"matchedForm":"x","meta":{"a":1,"b":{"c":2,"d":{"e":3}}}}]}';

    const items = extractNewItems(buffer, 0);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      matchedForm: "x",
      meta: { a: 1, b: { c: 2, d: { e: 3 } } },
    });
  });

  // ── (e) malformed / incomplete JSON returns [] without throwing ───────────
  it("returns [] without throwing on truncated or junk input", () => {
    // Random text — no `"flagged"` key at all.
    expect(extractNewItems("absolute garbage 123", 0)).toEqual([]);

    // Key present but the array hasn't opened yet.
    expect(extractNewItems('{"flagged":', 0)).toEqual([]);

    // Array opened, no items yet.
    expect(extractNewItems('{"flagged":[', 0)).toEqual([]);

    // Element started but never closes.
    expect(extractNewItems('{"flagged":[{"matchedForm":"cas', 0)).toEqual([]);

    // Whitespace + truncation between elements is fine.
    expect(
      extractNewItems(
        '{"flagged":[{"matchedForm":"a"},\n  {"matchedForm":"b"',
        0,
      ),
    ).toEqual([{ matchedForm: "a" }]);
  });

  // ── alreadyYielded skips already-emitted items (Req 4.3) ──────────────────
  it("skips items at indices < alreadyYielded", () => {
    const buffer =
      '{"flagged":[{"matchedForm":"a"},{"matchedForm":"b"},{"matchedForm":"c"}]}';

    expect(extractNewItems(buffer, 0)).toEqual([
      { matchedForm: "a" },
      { matchedForm: "b" },
      { matchedForm: "c" },
    ]);
    expect(extractNewItems(buffer, 2)).toEqual([{ matchedForm: "c" }]);
    expect(extractNewItems(buffer, 3)).toEqual([]);
  });
});

describe("buildAnnotateUserPrompt", () => {
  const baseInput = {
    text: "La aldea recibió al pintor con cierta indiferencia.",
    language: Language.ES,
    proficiencyLevel: CefrLevel.B1,
  } as const;

  // ── (a) every matchedForm appears exactly once ────────────────────────────
  it("renders every candidate's matchedForm exactly once", () => {
    const candidates = [
      { matchedForm: "aldea", lemma: "aldea" },
      { matchedForm: "recibió", lemma: "recibir" },
      { matchedForm: "indiferencia", lemma: "indiferencia" },
    ];
    const prompt = buildAnnotateUserPrompt({ ...baseInput, candidates });

    for (const c of candidates) {
      // Match the rendered list entry — `\n1. aldea`, `\n2. recibió`, etc.
      // The body of the passage may also contain the surface form, but the
      // numbered list line above guarantees one *list-row* occurrence per
      // candidate. Uses a line-end / space lookahead instead of `\b` because
      // JS `\b` treats accented chars (`ó`) as non-word.
      const listLineRe = new RegExp(`\\n\\d+\\. ${c.matchedForm}(?=$| )`, "gm");
      const listMatches = prompt.match(listLineRe);
      expect(listMatches, `list entry for ${c.matchedForm}`).not.toBeNull();
      expect(listMatches!.length).toBe(1);
    }
  });

  // ── (b) lemmas (when non-null) appear alongside the surface form ──────────
  it("emits the lemma alongside the surface form when non-null and distinct", () => {
    const prompt = buildAnnotateUserPrompt({
      ...baseInput,
      candidates: [
        // surface form differs from lemma → annotate with "(lemma: …)"
        { matchedForm: "recibió", lemma: "recibir" },
        // lemma === matchedForm → no lemma suffix (redundant info)
        { matchedForm: "aldea", lemma: "aldea" },
        // lemma is null → no lemma suffix
        { matchedForm: "indiferencia", lemma: null },
      ],
    });
    expect(prompt).toContain("recibió (lemma: recibir)");
    expect(prompt).toContain("\n2. aldea\n"); // no suffix when lemma == form
    expect(prompt).toMatch(/\n3\. indiferencia(?:\n|$)/); // no suffix when null
  });

  // ── (c) language code appears in the prompt header ────────────────────────
  it("includes the language code in the prompt header", () => {
    const prompt = buildAnnotateUserPrompt({
      ...baseInput,
      candidates: [{ matchedForm: "aldea", lemma: "aldea" }],
    });
    expect(prompt).toMatch(/\*\*Language:\*\* ES\b/);
    expect(prompt).toMatch(/\*\*User CEFR Level:\*\* B1\b/);
  });

  // ── (d) empty candidate list is rejected by an upstream assertion ─────────
  it("throws on an empty candidate list (failsafe — handler short-circuits upstream)", () => {
    // Production paths short-circuit before reaching the builder when there
    // are no candidates (Req 1.6 / 2.7). The throw is here so that any bug
    // that bypasses the short-circuit surfaces loudly instead of sending
    // Claude an enrichment request with no words.
    expect(() =>
      buildAnnotateUserPrompt({ ...baseInput, candidates: [] }),
    ).toThrow(/non-empty/i);
  });
});

// ---------------------------------------------------------------------------
// streamAnnotation — integration tests against a mocked Anthropic SDK
// ---------------------------------------------------------------------------

const validItem1 = {
  matchedForm: "casa",
  lemma: "casa",
  pos: "noun",
  gloss: "house",
  example: "Vivo en una casa grande.",
  freq: 74,
  cefr: "A2",
};

const validItem2 = {
  matchedForm: "indiferencia",
  lemma: "indiferencia",
  pos: "noun",
  gloss: "indifference",
  example: "Lo trató con indiferencia.",
  freq: 3023,
  cefr: "C1",
};

/** Builds a mock `MessageStream` from a list of partial-JSON deltas. */
function fakeStream(
  deltas: ReadonlyArray<string>,
  opts: {
    stopReason?: "end_turn" | "max_tokens" | "tool_use";
    /** When set, the iterator throws the first time `aborted` flips true. */
    abortSignal?: AbortSignal;
    /** When set, the iterator throws this error before yielding anything. */
    throwOnIterate?: Error;
  } = {},
) {
  return {
    async *[Symbol.asyncIterator]() {
      if (opts.throwOnIterate) throw opts.throwOnIterate;
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
    finalMessage: async () => ({ stop_reason: opts.stopReason ?? "end_turn" }),
  };
}

const baseStreamInput: AnnotateStreamInput = {
  text: "La aldea recibió al pintor con cierta indiferencia.",
  language: Language.ES,
  proficiencyLevel: CefrLevel.B1,
  candidates: [{ matchedForm: "casa", lemma: "casa" }],
};

async function collect(iterable: AsyncIterable<AnnotateStreamEvent>) {
  const events: AnnotateStreamEvent[] = [];
  for await (const ev of iterable) events.push(ev);
  return events;
}

describe("streamAnnotation", () => {
  // ── (a) two complete items end-to-end ─────────────────────────────────────
  it("yields flag, flag, done for two complete items", async () => {
    // Two deltas that together form `{"flagged":[item1,item2]}`.
    const fullJson = JSON.stringify({ flagged: [validItem1, validItem2] });
    const split = Math.floor(fullJson.length / 2);
    const deltas = [fullJson.slice(0, split), fullJson.slice(split)];

    const stream = fakeStream(deltas);
    const client = {
      messages: { stream: vi.fn(() => stream) },
    } as unknown as Anthropic;

    const events = await collect(streamAnnotation(client, baseStreamInput));

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      kind: "flag",
      flag: { ...validItem1 },
    });
    expect(events[1]).toEqual({
      kind: "flag",
      flag: { ...validItem2 },
    });
    expect(events[2]).toEqual({ kind: "done", flaggedCount: 2 });
  });

  // ── (b) AbortSignal fired mid-stream ──────────────────────────────────────
  it("ends without `done` when the AbortSignal fires mid-stream", async () => {
    // First delta completes item1; iterator then checks the abort signal
    // before yielding the next delta.
    const fullJson = JSON.stringify({ flagged: [validItem1, validItem2] });
    // Split at the boundary between item1 and item2 so the first chunk
    // contains exactly one complete item.
    const firstItemEnd = fullJson.indexOf("},") + 1;
    const deltas = [
      fullJson.slice(0, firstItemEnd),
      fullJson.slice(firstItemEnd),
    ];

    const controller = new AbortController();
    const stream = fakeStream(deltas, { abortSignal: controller.signal });
    const client = {
      messages: { stream: vi.fn(() => stream) },
    } as unknown as Anthropic;

    // Iterate manually so we can abort between events.
    const iterator = streamAnnotation(client, {
      ...baseStreamInput,
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({ kind: "flag", flag: { ...validItem1 } });

    controller.abort();

    // The next pull pumps the mock iterator, which sees `aborted = true`
    // and throws — the generator never reaches `yield done`.
    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
  });

  // ── (c) malformed item between two valid ones is dropped ──────────────────
  it("drops a single malformed item and continues the stream", async () => {
    const malformed = {
      // Missing `gloss` — fails WordFlagSchema.parse, NOT JSON.parse.
      matchedForm: "x",
      lemma: "x",
      pos: "noun",
      example: "x",
      freq: 999,
      cefr: "B2",
    };

    const fullJson = JSON.stringify({
      flagged: [validItem1, malformed, validItem2],
    });

    const stream = fakeStream([fullJson]);
    const client = {
      messages: { stream: vi.fn(() => stream) },
    } as unknown as Anthropic;

    // Silence the expected console.warn during this test only.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const events = await collect(streamAnnotation(client, baseStreamInput));

      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ kind: "flag", flag: { ...validItem1 } });
      expect(events[1]).toEqual({ kind: "flag", flag: { ...validItem2 } });
      expect(events[2]).toEqual({ kind: "done", flaggedCount: 2 });

      // Warn fired exactly once for the dropped item.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("dropped malformed item");
    } finally {
      warnSpy.mockRestore();
    }
  });

  // ── (slim) a flag that omits `example` is accepted and streamed (Req 1.1) ─
  it("accepts and streams a slim flag that omits `example`", async () => {
    // The slimmed skim card no longer emits `example`; WordFlagSchema made it
    // optional, so the item validates and streams without that field.
    const slimItem = {
      matchedForm: "vapor",
      lemma: "vapor",
      pos: "noun",
      gloss: "steam",
      freq: 7000,
      cefr: "B2",
    };
    const stream = fakeStream([JSON.stringify({ flagged: [slimItem] })]);
    const client = {
      messages: { stream: vi.fn(() => stream) },
    } as unknown as Anthropic;

    const events = await collect(streamAnnotation(client, baseStreamInput));

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ kind: "flag", flag: { ...slimItem } });
    expect(events[1]).toEqual({ kind: "done", flaggedCount: 1 });
    // The streamed flag carries no `example` key.
    if (events[0].kind === "flag") {
      expect(events[0].flag).not.toHaveProperty("example");
    }
  });

  // ── (propn) a pos=proper-noun item is dropped before streaming (Req 2.4) ──
  it("drops an item whose pos is a proper noun before streaming", async () => {
    // Defense in depth: the prompt tells Claude not to flag proper nouns, but
    // any it tags as one (pos: "proper noun") is dropped server-side before a
    // `flag` event is emitted — so only the two real words + `done` remain.
    const propnItem = {
      matchedForm: "madrid",
      lemma: "Madrid",
      pos: "proper noun",
      gloss: "capital of spain",
      freq: 1500,
      cefr: "A1",
    };
    const stream = fakeStream([
      JSON.stringify({ flagged: [validItem1, propnItem, validItem2] }),
    ]);
    const client = {
      messages: { stream: vi.fn(() => stream) },
    } as unknown as Anthropic;

    const events = await collect(streamAnnotation(client, baseStreamInput));

    // The proper-noun item is silently dropped (it parses fine — it is not
    // malformed — so the drop is by pos, not by validation failure).
    expect(events).toEqual([
      { kind: "flag", flag: { ...validItem1 } },
      { kind: "flag", flag: { ...validItem2 } },
      { kind: "done", flaggedCount: 2 },
    ]);
  });

  // ── (d) Anthropic SDK throws → exception propagates ───────────────────────
  it("propagates an SDK error out of the iterator", async () => {
    const sdkError = new Error("network down");
    const stream = fakeStream([], { throwOnIterate: sdkError });
    const client = {
      messages: { stream: vi.fn(() => stream) },
    } as unknown as Anthropic;

    await expect(collect(streamAnnotation(client, baseStreamInput))).rejects.toBe(
      sdkError,
    );
  });

  // ── (bonus) max_tokens stop_reason throws AnnotateStreamMaxTokensError ────
  it("throws AnnotateStreamMaxTokensError on stop_reason: max_tokens", async () => {
    // One valid item, then stream completes with max_tokens. The dedicated
    // error class lets the handler (task 24b) map this case to `AI_UNAVAILABLE`
    // without catching every Error.
    const fullJson = JSON.stringify({ flagged: [validItem1] });
    const stream = fakeStream([fullJson], { stopReason: "max_tokens" });
    const client = {
      messages: { stream: vi.fn(() => stream) },
    } as unknown as Anthropic;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await expect(
        collect(streamAnnotation(client, baseStreamInput)),
      ).rejects.toBeInstanceOf(AnnotateStreamMaxTokensError);

      // Observability: warn fires before the throw so CloudWatch captures it.
      expect(warnSpy).toHaveBeenCalledWith(
        "[streamAnnotation] truncated by max_tokens",
        { yielded: 1 },
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  // ── (bonus) empty candidates short-circuit assertion ──────────────────────
  it("throws if called with an empty candidates list (failsafe)", async () => {
    const stream = fakeStream([]);
    const client = {
      messages: { stream: vi.fn(() => stream) },
    } as unknown as Anthropic;

    await expect(
      collect(
        streamAnnotation(client, { ...baseStreamInput, candidates: [] }),
      ),
    ).rejects.toThrow(/non-empty/i);
    // The mock SDK should not even have been called.
    expect((client.messages.stream as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// streamAnnotation + prompts-registry integration (Phase 2 — Task 8)
// ---------------------------------------------------------------------------

/**
 * These cases pin the override + fallback paths for Phase 2's
 * `getPromptOrFallback` integration in `streamAnnotation`. Matches the
 * shape of the `evaluateAnswer + prompts-registry` block in
 * `evaluate.test.ts` so the two surfaces stay symmetric.
 */
describe("streamAnnotation + prompts-registry", () => {
  const ENV_KEYS = [
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
    "LANGFUSE_BASE_URL",
  ] as const;
  const envSnapshot = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      envSnapshot.set(k, process.env[k]);
      delete process.env[k];
    }
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
      feature: "annotate",
      env: "dev",
      promptVersion: "pending",
      requestId: "test-request-annotate-001",
      userId: "dev_user_001",
      language: Language.ES,
      cefrLevel: CefrLevel.B1,
      ...overrides,
    };
  }

  it("uses systemPromptOverride verbatim in the messages.stream system block", async () => {
    const override = "CUSTOM_CANDIDATE_ANNOTATE_PROMPT body";
    const fullJson = JSON.stringify({ flagged: [validItem1] });
    const stream = fakeStream([fullJson]);
    const streamSpy = vi.fn(() => stream);
    const client = {
      messages: { stream: streamSpy },
    } as unknown as Anthropic;

    await collect(
      streamAnnotation(client, {
        ...baseStreamInput,
        systemPromptOverride: override,
      }),
    );

    const callArgs = streamSpy.mock.calls[0][0] as {
      system: Array<{ type: string; text: string; cache_control: unknown }>;
    };
    expect(callArgs.system).toEqual([
      {
        type: "text",
        text: override,
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("stamps promptVersion=override:<sha8> on the trace when systemPromptOverride is set", async () => {
    const override = "CUSTOM_CANDIDATE_ANNOTATE_PROMPT body";
    const expectedTag = `override:${sha8(override)}`;
    const fullJson = JSON.stringify({ flagged: [validItem1] });
    const stream = fakeStream([fullJson]);
    const client = {
      messages: { stream: vi.fn(() => stream) },
    } as unknown as Anthropic;

    await withLlmTrace(baseCtx(), async () => {
      await collect(
        streamAnnotation(client, {
          ...baseStreamInput,
          systemPromptOverride: override,
        }),
      );
      const ctx = getCurrentLlmTraceContext();
      expect(ctx?.promptVersion).toBe(expectedTag);
      expect(ctx?.promptFallback).toBe(false);
    });
  });

  it("falls back to ANNOTATE_SYSTEM_PROMPT with `fallback:<v>` promptVersion when no override + Langfuse unset", async () => {
    const expectedTag = `fallback:${ANNOTATE_SYSTEM_PROMPT_VERSION}`;
    const fullJson = JSON.stringify({ flagged: [validItem1] });
    const stream = fakeStream([fullJson]);
    const streamSpy = vi.fn(() => stream);
    const client = {
      messages: { stream: streamSpy },
    } as unknown as Anthropic;

    await withLlmTrace(baseCtx(), async () => {
      await collect(streamAnnotation(client, baseStreamInput));
      const ctx = getCurrentLlmTraceContext();
      expect(ctx?.promptVersion).toBe(expectedTag);
      expect(ctx?.promptFallback).toBe(true);
    });

    // Sanity: fallback path produces byte-identical system text to pre-Phase-2.
    const callArgs = streamSpy.mock.calls[0][0] as {
      system: Array<{ type: string; text: string; cache_control: unknown }>;
    };
    expect(callArgs.system).toEqual([
      {
        type: "text",
        text: ANNOTATE_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ]);
  });
});
