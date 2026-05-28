/**
 * Skeleton-contract tests for `observability.ts` (Phase 1, Task 5).
 *
 * These pin the no-op behavior so that:
 *   1. Existing callers can swap `createClaudeClient` → `createObservedClaudeClient`
 *      without behavioral drift before the Proxy (Task 8) lands.
 *   2. The ALS context-propagation contract is locked from day one — Task 8
 *      will only need to *read* `getCurrentLlmTraceContext()`; it must not
 *      need to change the way scopes are entered/exited.
 *
 * Tests for the real Proxy (success / error / stream / truncate / cost
 * mapping / Langfuse-fail paths) live in this same file and grow with
 * Tasks 7–9; this file currently covers only the surface that Task 4
 * established.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { Langfuse } from "langfuse";
import { CefrLevel, ExerciseType, Language } from "@language-drill/shared";
import { ANNOTATE_TOOL_NAME } from "./annotate.js";
import { EVALUATION_TOOL_NAME } from "./evaluate.js";
import { READ_SPAN_TOOL_NAME } from "./read-span.js";
import { TOOL_NAME_BY_TYPE } from "./generate.js";
import { THEORY_TOOL_NAME } from "./theory-generate.js";
import { THEORY_VALIDATION_TOOL_NAME } from "./theory-validate.js";
import { VALIDATION_TOOL_NAME } from "./validate.js";
import {
  __resetForTests,
  createObservedClaudeClient,
  flushObservability,
  getCurrentLlmTraceContext,
  getLangfuse,
  LANGFUSE_FLUSH_TIMEOUT_MS,
  setResolvedPromptClient,
  setResolvedPromptVersion,
  TOOL_NAME_TO_FEATURE,
  withLlmTrace,
  type LlmFeature,
  type LlmTraceContext,
} from "./observability.js";

// Replace the real Langfuse constructor with a spy. Default behavior:
// each `new Langfuse(opts)` assigns a fresh `flushAsync` mock to `this`,
// producing an instance shaped like the SDK's. Individual tests override
// per-case via `vi.mocked(Langfuse).mockImplementationOnce(...)`.
//
// NB: the constructor pattern uses `this`-assignment rather than
// `() => ({...})` because vitest 4.1.5's `vi.fn()` does not honor
// implementations that return a value when invoked with `new` — verified
// locally before settling on this pattern.
vi.mock("langfuse", () => {
  const LangfuseMock = vi.fn(function (this: { flushAsync: () => Promise<void> }) {
    this.flushAsync = vi.fn().mockResolvedValue(undefined);
  });
  return { Langfuse: LangfuseMock };
});

// Hoisted Anthropic mock — replaces the default export so the Proxy in
// `createObservedClaudeClient` wraps a stub instead of hitting the real
// API. Each test configures the response per-case via
// `mocks.mockCreate.mockResolvedValueOnce(...)` / `mockRejectedValueOnce`.
const mocks = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockStream: vi.fn(),
}));
vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = {
      create: mocks.mockCreate,
      stream: mocks.mockStream,
    };
    constructor(_opts: { apiKey: string }) {
      void _opts;
    }
  }
  return { default: MockAnthropic };
});

// ---------------------------------------------------------------------------
// Env-var + singleton state hygiene
// ---------------------------------------------------------------------------

// Snapshot the Langfuse-related env vars so we can restore them after each
// test. Combined with `__resetForTests()`, this lets cases freely toggle
// configuration without leaking state into siblings.
const ENV_KEYS = [
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_BASE_URL",
  "LANGFUSE_SAMPLE_RATE",
] as const;

const envSnapshot = new Map<string, string | undefined>();

beforeEach(() => {
  for (const k of ENV_KEYS) {
    envSnapshot.set(k, process.env[k]);
    delete process.env[k];
  }
  __resetForTests();
  vi.mocked(Langfuse).mockClear();
  mocks.mockCreate.mockReset();
  mocks.mockStream.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = envSnapshot.get(k);
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  __resetForTests();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<LlmTraceContext> = {}): LlmTraceContext {
  return {
    feature: "evaluate",
    env: "dev",
    promptVersion: "evaluate@2026-05-12",
    requestId: "test-request-001",
    userId: "dev_user_001",
    language: Language.ES,
    cefrLevel: CefrLevel.B1,
    exerciseType: ExerciseType.CLOZE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createObservedClaudeClient — vanilla Anthropic, no Proxy yet (Req 1 AC 2)
// ---------------------------------------------------------------------------

describe("createObservedClaudeClient (skeleton)", () => {
  it("returns an Anthropic instance with a messages.create function", () => {
    const client = createObservedClaudeClient("test-api-key");
    expect(client).toBeInstanceOf(Anthropic);
    expect(typeof client.messages.create).toBe("function");
    expect(typeof client.messages.stream).toBe("function");
  });

  it("returns a Proxy (still instanceof Anthropic) when keys are set", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    const client = createObservedClaudeClient("test-api-key");
    // The Proxy preserves the prototype chain, so instanceof still works.
    // The wrapping is on `.messages` only — exercised by the Proxy tests
    // further down.
    expect(client).toBeInstanceOf(Anthropic);
    expect(typeof client.messages.create).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Anthropic Proxy — `messages.create` path (Req 1.3, 2.1, 5.1, 5.3, 7.1, 7.2)
// ---------------------------------------------------------------------------

type FakeAnthropicCreateRequest = {
  model: string;
  max_tokens: number;
  messages: ReadonlyArray<{ role: string; content: string }>;
  tools: ReadonlyArray<{ name: string }>;
  system?: string;
  temperature?: number;
  tool_choice?: unknown;
};

/** Minimal fixture request used by the Proxy success/error tests. */
function makeRequest(
  toolName = EVALUATION_TOOL_NAME,
): FakeAnthropicCreateRequest {
  return {
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: "you are a helper",
    messages: [{ role: "user", content: "hi" }],
    tools: [{ name: toolName }],
    tool_choice: { type: "tool", name: toolName },
    temperature: 0,
  };
}

/** Capture-the-calls Langfuse mock — used by the Proxy success-path test. */
function installLangfuseSpyMock() {
  const traceCalls: unknown[] = [];
  const genCalls: unknown[] = [];
  const endCalls: unknown[] = [];
  vi.mocked(Langfuse).mockImplementationOnce(function (
    this: {
      flushAsync: () => Promise<void>;
      trace: (b: unknown) => unknown;
    },
  ) {
    this.flushAsync = vi.fn().mockResolvedValue(undefined);
    this.trace = (body: unknown) => {
      traceCalls.push(body);
      return {
        generation: (gbody: unknown) => {
          genCalls.push(gbody);
          return {
            end: (ebody: unknown) => {
              endCalls.push(ebody);
            },
          };
        },
      };
    };
  });
  return { traceCalls, genCalls, endCalls };
}

describe("Anthropic Proxy — messages.create", () => {
  beforeEach(() => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";
  });

  it("emits a Langfuse generation with metadata, tags, and parsed tool_use output on success", async () => {
    const spies = installLangfuseSpyMock();
    const mockResponse = {
      content: [
        {
          type: "tool_use",
          id: "x",
          name: EVALUATION_TOOL_NAME,
          input: { score: 0.8, feedback: "good" },
        },
      ],
      usage: {
        input_tokens: 100,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 200,
        output_tokens: 30,
      },
      stop_reason: "tool_use",
    };
    mocks.mockCreate.mockResolvedValueOnce(mockResponse);

    const client = createObservedClaudeClient("api-key");

    const ctx = makeCtx({
      feature: "evaluate",
      submissionId: "sub-xyz",
      requestId: "req-1",
    });
    const result = await withLlmTrace(ctx, () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.messages.create as any)(makeRequest()),
    );

    expect(result).toEqual(mockResponse);

    // Trace was created with the right user / tags / metadata. Note:
    // language / cefrLevel / exerciseType appear in BOTH `metadata`
    // (for dashboard group-by — Req 9 AC 1) and `tags` (for filter-
    // search). The tag assertions below cover the latter.
    expect(spies.traceCalls).toHaveLength(1);
    expect(spies.traceCalls[0]).toMatchObject({
      name: "evaluate",
      userId: "dev_user_001",
      metadata: expect.objectContaining({
        feature: "evaluate",
        env: "dev",
        promptVersion: ctx.promptVersion,
        requestId: "req-1",
        submissionId: "sub-xyz",
        model: "claude-sonnet-4-6",
        language: "es",
        cefrLevel: "B1",
        exerciseType: "cloze",
      }),
    });
    // v2 tag schema (`dimension:value`) — see `buildTraceTags` for why.
    // Each tag is a namespaced key:value pair so dashboards can both
    // filter (`tag matches language:*`) AND group by tag (each distinct
    // value becomes a breakdown bucket).
    const tags = (spies.traceCalls[0] as { tags: string[] }).tags;
    expect(tags).toEqual(
      expect.arrayContaining([
        "feature:evaluate",
        "env:dev",
        "model:claude-sonnet-4-6",
        // promptVersion derives from makeCtx — match the date-stamped pattern
        // rather than a literal so prompt-version bumps don't break tests.
        expect.stringMatching(/^promptVersion:evaluate@\d{4}-\d{2}-\d{2}$/),
        "language:es",
        "cefrLevel:B1",
        "exerciseType:cloze",
        "submissionId:sub-xyz",
      ]),
    );

    // Generation was created with the input payload.
    expect(spies.genCalls).toHaveLength(1);
    expect(spies.genCalls[0]).toMatchObject({
      name: "evaluate",
      model: "claude-sonnet-4-6",
      input: {
        system: "you are a helper",
        messages: [{ role: "user", content: "hi" }],
      },
      modelParameters: expect.objectContaining({
        temperature: 0,
        max_tokens: 1024,
      }),
    });

    // Generation.end called with parsed tool_use output + four-bucket usage.
    // `metadata.score` mirrors the numeric `score` from the tool input so
    // dashboards can compute `avg(metadata.score)` grouped by language
    // (user-progress metric — NOT a Langfuse Scores API value).
    expect(spies.endCalls).toHaveLength(1);
    expect(spies.endCalls[0]).toMatchObject({
      output: { score: 0.8, feedback: "good" },
      usageDetails: {
        input: 100,
        cache_creation_input: 50,
        cache_read_input: 200,
        output: 30,
      },
      costDetails: expect.objectContaining({
        input: expect.any(Number),
        cache_creation_input: expect.any(Number),
        cache_read_input: expect.any(Number),
        output: expect.any(Number),
        // Explicit `total` key — Langfuse's dashboard widget reads this
        // directly rather than summing custom buckets server-side.
        total: expect.any(Number),
      }),
      metadata: { score: 0.8 },
    });
  });

  it("omits metadata.score when the tool input has no numeric `score` field (validate / generate / annotate)", async () => {
    const spies = installLangfuseSpyMock();
    mocks.mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "v",
          name: VALIDATION_TOOL_NAME,
          // No `score` field — typical for validate/generate tool outputs.
          input: { ok: true, reason: null },
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: "tool_use",
    });

    const client = createObservedClaudeClient("api-key");
    await withLlmTrace(
      makeCtx({ feature: "generate", jobId: "job-1", cellKey: "es|B1|cloze" }),
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client.messages.create as any)(makeRequest(VALIDATION_TOOL_NAME)),
    );

    // `gen.end` is called but without a `metadata` key — confirms the
    // guard `typeof === 'number'` doesn't fire on the absent field.
    expect(spies.endCalls).toHaveLength(1);
    expect(spies.endCalls[0]).not.toHaveProperty("metadata");
  });

  it("disambiguates `feature` via TOOL_NAME_TO_FEATURE (validate tool inside generate scope)", async () => {
    const spies = installLangfuseSpyMock();
    mocks.mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "v", name: VALIDATION_TOOL_NAME, input: { ok: true } }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "tool_use",
    });

    const client = createObservedClaudeClient("api-key");

    await withLlmTrace(
      makeCtx({ feature: "generate", jobId: "job-1", cellKey: "es|B1|cloze" }),
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client.messages.create as any)(makeRequest(VALIDATION_TOOL_NAME)),
    );

    expect(spies.traceCalls[0]).toMatchObject({ name: "validate" });
    const tags = (spies.traceCalls[0] as { tags: string[] }).tags;
    // v2 schema — namespaced. Also asserts cellKey landed as a tag so
    // dashboard 4 (per-cell rejection rate) can group by it.
    expect(tags).toContain("feature:validate");
    expect(tags).toContain("cellKey:es|B1|cloze");
    // Generate-side ALS metadata still passes through.
    expect(spies.traceCalls[0]).toMatchObject({
      metadata: expect.objectContaining({
        jobId: "job-1",
        cellKey: "es|B1|cloze",
      }),
    });
  });

  it("finalizes with level=ERROR and re-throws when Claude throws", async () => {
    const spies = installLangfuseSpyMock();
    mocks.mockCreate.mockRejectedValueOnce(new Error("upstream 503"));

    const client = createObservedClaudeClient("api-key");

    await expect(
      withLlmTrace(makeCtx(), () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client.messages.create as any)(makeRequest()),
      ),
    ).rejects.toThrow("upstream 503");

    expect(spies.endCalls).toHaveLength(1);
    expect(spies.endCalls[0]).toEqual({
      level: "ERROR",
      statusMessage: "upstream 503",
    });
  });

  it("lets the Claude call resolve normally when the Langfuse SDK throws (Req 7 AC 2)", async () => {
    // Trace creation throws — the Proxy must swallow and proceed.
    vi.mocked(Langfuse).mockImplementationOnce(function (
      this: {
        flushAsync: () => Promise<void>;
        trace: () => unknown;
      },
    ) {
      this.flushAsync = vi.fn().mockResolvedValue(undefined);
      this.trace = () => {
        throw new Error("LF down");
      };
    });
    const ok = {
      content: [
        {
          type: "tool_use",
          id: "x",
          name: EVALUATION_TOOL_NAME,
          input: { score: 1 },
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "tool_use",
    };
    mocks.mockCreate.mockResolvedValueOnce(ok);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createObservedClaudeClient("api-key");
    const result = await withLlmTrace(makeCtx(), () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.messages.create as any)(makeRequest()),
    );

    expect(result).toEqual(ok);
    // Exactly one warn — the one-shot gate covers per-Lambda dedup.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("[observability]");
    warnSpy.mockRestore();
  });

  it("falls back to ALS feature and warns when tool name is unknown", async () => {
    const spies = installLangfuseSpyMock();
    mocks.mockCreate.mockResolvedValueOnce({
      content: [],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "end_turn",
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createObservedClaudeClient("api-key");

    await withLlmTrace(makeCtx({ feature: "evaluate" }), () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.messages.create as any)({
        ...makeRequest(),
        tools: [{ name: "submit_mystery_tool" }],
      }),
    );

    expect(spies.traceCalls[0]).toMatchObject({ name: "evaluate" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][1]).toContain("submit_mystery_tool");
    warnSpy.mockRestore();
  });

  it("passes through when no ALS scope is set (no trace emitted)", async () => {
    const spies = installLangfuseSpyMock();
    mocks.mockCreate.mockResolvedValueOnce({
      content: [],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "end_turn",
    });

    const client = createObservedClaudeClient("api-key");
    // No withLlmTrace wrap.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (client.messages.create as any)(makeRequest());

    expect(result.usage.input_tokens).toBe(1);
    expect(spies.traceCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Phase-2: onTraceCreated callback + promptFallback metadata
  // -------------------------------------------------------------------------

  it("invokes onTraceCreated once with a non-null LangfuseTraceClient", async () => {
    // Distinct mock that returns the trace object so we can compare
    // identity. The callback should receive exactly this object.
    const traceObj = {
      id: "trace-abc",
      generation: () => ({ end: () => {} }),
    };
    vi.mocked(Langfuse).mockImplementationOnce(function (
      this: {
        flushAsync: () => Promise<void>;
        trace: () => unknown;
      },
    ) {
      this.flushAsync = vi.fn().mockResolvedValue(undefined);
      this.trace = () => traceObj;
    });
    mocks.mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "x",
          name: EVALUATION_TOOL_NAME,
          input: { score: 0.5 },
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "tool_use",
    });

    const callback = vi.fn();
    const client = createObservedClaudeClient("api-key");
    await withLlmTrace(makeCtx({ onTraceCreated: callback }), () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.messages.create as any)(makeRequest()),
    );

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toBe(traceObj);
  });

  it("swallows a throwing onTraceCreated callback and warns once", async () => {
    installLangfuseSpyMock();
    mocks.mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "x",
          name: EVALUATION_TOOL_NAME,
          input: { score: 1 },
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "tool_use",
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createObservedClaudeClient("api-key");
    const onTraceCreated = vi.fn(() => {
      throw new Error("callback boom");
    });

    // The Claude call must resolve normally even though the callback threw.
    const result = await withLlmTrace(makeCtx({ onTraceCreated }), () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.messages.create as any)(makeRequest()),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).usage.input_tokens).toBe(1);
    expect(onTraceCreated).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][1]).toContain("onTraceCreated");
    warnSpy.mockRestore();
  });

  it("surfaces ctx.promptFallback=true as trace metadata (Req 4 AC 2)", async () => {
    const spies = installLangfuseSpyMock();
    mocks.mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "x",
          name: EVALUATION_TOOL_NAME,
          input: { score: 0.5 },
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "tool_use",
    });

    const client = createObservedClaudeClient("api-key");
    await withLlmTrace(makeCtx({ promptFallback: true }), () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.messages.create as any)(makeRequest()),
    );

    expect(spies.traceCalls).toHaveLength(1);
    expect(spies.traceCalls[0]).toMatchObject({
      metadata: expect.objectContaining({ promptFallback: true }),
    });
  });

  it("forwards ctx.promptClient to trace.generation as `prompt` so Langfuse links the prompt entry", async () => {
    const spies = installLangfuseSpyMock();
    mocks.mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "x",
          name: EVALUATION_TOOL_NAME,
          input: { score: 0.5 },
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "tool_use",
    });

    // Stub: any object satisfies the `prompt` slot (Langfuse SDK uses it
    // for identity, not introspection). Cast keeps the test stub from
    // re-implementing TextPromptClient's full surface.
    const fakePromptClient = { name: "evaluate-system-prompt", version: 7 };

    const client = createObservedClaudeClient("api-key");
    await withLlmTrace(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeCtx({ promptClient: fakePromptClient as any }),
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client.messages.create as any)(makeRequest()),
    );

    expect(spies.genCalls).toHaveLength(1);
    expect(spies.genCalls[0]).toMatchObject({ prompt: fakePromptClient });
  });

  it("omits the `prompt` field on the generation when ctx.promptClient is null (fallback / override path)", async () => {
    const spies = installLangfuseSpyMock();
    mocks.mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "x",
          name: EVALUATION_TOOL_NAME,
          input: { score: 0.5 },
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "tool_use",
    });

    const client = createObservedClaudeClient("api-key");
    await withLlmTrace(makeCtx({ promptClient: null }), () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.messages.create as any)(makeRequest()),
    );

    expect(spies.genCalls).toHaveLength(1);
    // Langfuse rejects an explicit `null` for `prompt`; we must omit the
    // key entirely. The fallback-path trace stays valid with no link.
    expect(spies.genCalls[0]).not.toHaveProperty("prompt");
  });
});

// ---------------------------------------------------------------------------
// Anthropic Proxy — `messages.stream` path (Req 1.3, 2.2, 5.2, 5.3, 7.2)
// ---------------------------------------------------------------------------

/**
 * Build a fake `MessageStream`-shaped object. The `events` array is yielded
 * via `Symbol.asyncIterator`; `finalMessage()` returns `finalMessage` (or
 * rejects with `finalError`). Optionally make the iterator throw on
 * `iterError` after N events to simulate an abort.
 */
function makeMockStream(opts: {
  events: ReadonlyArray<unknown>;
  finalMessage?: unknown;
  finalError?: Error;
  iterError?: Error;
  iterErrorAfter?: number;
}): {
  [Symbol.asyncIterator](): AsyncIterator<unknown>;
  finalMessage: () => Promise<unknown>;
} {
  return {
    async *[Symbol.asyncIterator]() {
      let i = 0;
      for (const e of opts.events) {
        if (opts.iterError && i === (opts.iterErrorAfter ?? 0)) {
          throw opts.iterError;
        }
        yield e;
        i++;
      }
      if (opts.iterError && i === (opts.iterErrorAfter ?? 0)) {
        throw opts.iterError;
      }
    },
    finalMessage: vi.fn().mockImplementation(() => {
      if (opts.finalError) return Promise.reject(opts.finalError);
      return Promise.resolve(opts.finalMessage);
    }),
  };
}

/**
 * Build the JSON-delta event sequence the Anthropic SDK emits for a
 * tool-use stream that contains a `flagged: [...]` array of `n` items.
 * Each item is a minimal object shape — `extractNewItems` only needs
 * balanced braces, not WordFlag-schema-valid content.
 */
function buildFlaggedDeltas(n: number): Array<{
  type: string;
  delta: { type: string; partial_json: string };
}> {
  const items: string[] = [];
  for (let i = 0; i < n; i++) {
    items.push(`{"matchedForm":"w${i}","lemma":"w${i}","pos":"noun"}`);
  }
  const json = `{"flagged":[${items.join(",")}]}`;
  // For simplicity emit the whole JSON in one delta. `extractNewItems`
  // handles split deltas; that's covered by annotate-stream.test.ts.
  return [
    {
      type: "content_block_delta",
      delta: { type: "input_json_delta", partial_json: json },
    },
  ];
}

describe("Anthropic Proxy — messages.stream", () => {
  beforeEach(() => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";
  });

  it("yields events unchanged AND finalizes generation with collected items + usage", async () => {
    const spies = installLangfuseSpyMock();
    const events = buildFlaggedDeltas(3);
    const finalMsg = {
      stop_reason: "tool_use",
      usage: {
        input_tokens: 100,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 50,
      },
    };
    mocks.mockStream.mockReturnValueOnce(
      makeMockStream({ events, finalMessage: finalMsg }),
    );

    const client = createObservedClaudeClient("api-key");

    const yielded: unknown[] = [];
    await withLlmTrace(makeCtx({ feature: "annotate" }), async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = (client.messages.stream as any)(
        makeRequest(ANNOTATE_TOOL_NAME),
      ) as AsyncIterable<unknown>;
      for await (const ev of stream) {
        yielded.push(ev);
      }
    });

    // Events pass through unchanged.
    expect(yielded).toEqual(events);

    // Exactly one generation finalized with the three items + usage.
    expect(spies.endCalls).toHaveLength(1);
    const endBody = spies.endCalls[0] as {
      output: unknown[];
      usageDetails: Record<string, number>;
      costDetails: Record<string, number>;
      metadata: { flaggedCount: number; stop_reason: string };
      level?: string;
    };
    expect(endBody.output).toHaveLength(3);
    expect(endBody.usageDetails).toEqual({
      input: 100,
      cache_creation_input: 0,
      cache_read_input: 0,
      output: 50,
    });
    expect(endBody.metadata.flaggedCount).toBe(3);
    expect(endBody.metadata.stop_reason).toBe("tool_use");
    expect(endBody.level).toBeUndefined();
  });

  it("finalizes with level=WARNING when stop_reason is max_tokens (Req 5 AC 2)", async () => {
    const spies = installLangfuseSpyMock();
    const events = buildFlaggedDeltas(2);
    const finalMsg = {
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    mocks.mockStream.mockReturnValueOnce(
      makeMockStream({ events, finalMessage: finalMsg }),
    );

    const client = createObservedClaudeClient("api-key");
    await withLlmTrace(makeCtx({ feature: "annotate" }), async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = (client.messages.stream as any)(
        makeRequest(ANNOTATE_TOOL_NAME),
      ) as AsyncIterable<unknown>;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ev of stream) {
        // consume
      }
    });

    expect(spies.endCalls).toHaveLength(1);
    const endBody = spies.endCalls[0] as {
      level: string;
      metadata: { stop_reason: string; flaggedCount: number };
      statusMessage?: string;
    };
    expect(endBody.level).toBe("WARNING");
    expect(endBody.metadata.stop_reason).toBe("max_tokens");
    expect(endBody.metadata.flaggedCount).toBe(2);
    expect(endBody.statusMessage).toContain("max_tokens");
  });

  it("finalizes with level=WARNING + client_disconnect on abort (design Scenario 4)", async () => {
    const spies = installLangfuseSpyMock();
    const events = buildFlaggedDeltas(1);
    const abortError = Object.assign(new Error("Request aborted"), {
      name: "AbortError",
    });
    mocks.mockStream.mockReturnValueOnce(
      makeMockStream({
        events,
        iterError: abortError,
        iterErrorAfter: 1,
      }),
    );

    const client = createObservedClaudeClient("api-key");
    await expect(
      withLlmTrace(makeCtx({ feature: "annotate" }), async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stream = (client.messages.stream as any)(
          makeRequest(ANNOTATE_TOOL_NAME),
        ) as AsyncIterable<unknown>;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ev of stream) {
          // first event ok, second iteration throws
        }
      }),
    ).rejects.toThrow("Request aborted");

    expect(spies.endCalls).toHaveLength(1);
    const endBody = spies.endCalls[0] as {
      level: string;
      statusMessage: string;
      metadata: { flaggedCount: number };
    };
    expect(endBody.level).toBe("WARNING");
    expect(endBody.statusMessage).toBe("client_disconnect");
    // Partial collected list — one item was teed before the abort.
    expect(endBody.metadata.flaggedCount).toBe(1);
  });

  it("finalizes only once even when both iteration end AND finalMessage() are awaited", async () => {
    const spies = installLangfuseSpyMock();
    const events = buildFlaggedDeltas(1);
    const finalMsg = {
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    mocks.mockStream.mockReturnValueOnce(
      makeMockStream({ events, finalMessage: finalMsg }),
    );

    const client = createObservedClaudeClient("api-key");
    await withLlmTrace(makeCtx({ feature: "annotate" }), async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = (client.messages.stream as any)(
        makeRequest(ANNOTATE_TOOL_NAME),
      ) as AsyncIterable<unknown> & { finalMessage: () => Promise<unknown> };
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ev of stream) {
        // consume
      }
      // Caller-side finalMessage — matches the real streamAnnotation flow.
      await stream.finalMessage();
    });

    expect(spies.endCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getLangfuse — lazy singleton + graceful failure (Req 1.2, 1.3, 7.1)
// ---------------------------------------------------------------------------

describe("getLangfuse", () => {
  it("returns null when both keys are unset (no warn)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getLangfuse()).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(vi.mocked(Langfuse)).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns null when only the public key is set", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-only";
    expect(getLangfuse()).toBeNull();
    expect(vi.mocked(Langfuse)).not.toHaveBeenCalled();
  });

  it("constructs Langfuse with the right config when both keys are set", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    process.env.LANGFUSE_BASE_URL = "https://lf.example.com";
    process.env.LANGFUSE_SAMPLE_RATE = "0.5";
    const result = getLangfuse();
    expect(result).not.toBeNull();
    expect(vi.mocked(Langfuse)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Langfuse)).toHaveBeenCalledWith({
      publicKey: "pk-test",
      secretKey: "sk-test",
      baseUrl: "https://lf.example.com",
      sampleRate: 0.5,
    });
  });

  it("memoizes — subsequent calls do not reconstruct", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    const a = getLangfuse();
    const b = getLangfuse();
    expect(a).toBe(b);
    expect(vi.mocked(Langfuse)).toHaveBeenCalledTimes(1);
  });

  it("memoizes the keys-missing decision too (does not re-check env)", () => {
    // Two consecutive calls with no keys: still no Langfuse construction.
    expect(getLangfuse()).toBeNull();
    expect(getLangfuse()).toBeNull();
    expect(vi.mocked(Langfuse)).not.toHaveBeenCalled();
  });

  it("ignores invalid LANGFUSE_SAMPLE_RATE values (falls back to SDK default)", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";
    process.env.LANGFUSE_SAMPLE_RATE = "not-a-number";
    getLangfuse();
    expect(vi.mocked(Langfuse)).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: undefined }),
    );
  });

  it("returns null and warns once when the Langfuse constructor throws", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";
    // Use `function`-style so vitest 4.1.5 doesn't emit its own
    // "did not use 'function' or 'class'" console.warn (which would
    // inflate the spy count below). Same pattern in the __resetForTests
    // case further down.
    vi.mocked(Langfuse).mockImplementationOnce(function () {
      throw new Error("simulated init failure");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getLangfuse()).toBeNull();
    // Second call should NOT re-attempt construction or warn again.
    expect(getLangfuse()).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // createObservedClaudeClient must still return vanilla Anthropic even
    // when init failed (Req 7 AC 1).
    expect(createObservedClaudeClient("x")).toBeInstanceOf(Anthropic);
    warnSpy.mockRestore();
  });

  it("re-initializes after __resetForTests", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";
    getLangfuse();
    expect(vi.mocked(Langfuse)).toHaveBeenCalledTimes(1);
    __resetForTests();
    getLangfuse();
    expect(vi.mocked(Langfuse)).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// withLlmTrace — ALS context propagation
// ---------------------------------------------------------------------------

describe("withLlmTrace", () => {
  it("makes the context visible to getCurrentLlmTraceContext inside fn", async () => {
    const ctx = makeCtx();
    const seen = await withLlmTrace(ctx, () => {
      return getCurrentLlmTraceContext();
    });
    expect(seen).toEqual(ctx);
  });

  it("returns the value resolved by fn", async () => {
    const value = await withLlmTrace(makeCtx(), () => 42);
    expect(value).toBe(42);

    const asyncValue = await withLlmTrace(
      makeCtx(),
      async () => Promise.resolve("ok"),
    );
    expect(asyncValue).toBe("ok");
  });

  it("propagates context across awaited microtasks inside fn", async () => {
    const ctx = makeCtx({ feature: "annotate", requestId: "rid-2" });
    const seen = await withLlmTrace(ctx, async () => {
      // Force a microtask hop so we know ALS travels with the continuation.
      await Promise.resolve();
      return getCurrentLlmTraceContext();
    });
    expect(seen?.feature).toBe("annotate");
    expect(seen?.requestId).toBe("rid-2");
  });

  it("does NOT leak context outside the scope", async () => {
    await withLlmTrace(makeCtx(), () => {
      expect(getCurrentLlmTraceContext()?.feature).toBe("evaluate");
    });
    expect(getCurrentLlmTraceContext()).toBeUndefined();
  });

  it("isolates concurrent scopes", async () => {
    const ctxA = makeCtx({ feature: "evaluate", requestId: "A" });
    const ctxB = makeCtx({ feature: "generate", requestId: "B" });

    const [a, b] = await Promise.all([
      withLlmTrace(ctxA, async () => {
        await Promise.resolve();
        return getCurrentLlmTraceContext();
      }),
      withLlmTrace(ctxB, async () => {
        await Promise.resolve();
        return getCurrentLlmTraceContext();
      }),
    ]);
    expect(a?.requestId).toBe("A");
    expect(b?.requestId).toBe("B");
  });

  it("propagates thrown errors from fn", async () => {
    await expect(
      withLlmTrace(makeCtx(), () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

// ---------------------------------------------------------------------------
// setResolvedPromptVersion — Phase-2 ALS mutator
// ---------------------------------------------------------------------------

describe("setResolvedPromptVersion", () => {
  it("mutates promptVersion + promptFallback visible to subsequent getCurrentLlmTraceContext", async () => {
    await withLlmTrace(makeCtx({ promptVersion: "pending" }), () => {
      expect(getCurrentLlmTraceContext()?.promptVersion).toBe("pending");
      expect(getCurrentLlmTraceContext()?.promptFallback).toBeUndefined();

      setResolvedPromptVersion("langfuse:7", false);

      expect(getCurrentLlmTraceContext()?.promptVersion).toBe("langfuse:7");
      expect(getCurrentLlmTraceContext()?.promptFallback).toBe(false);
    });
  });

  it("records the fallback flag when fromFallback is true", async () => {
    await withLlmTrace(makeCtx({ promptVersion: "pending" }), () => {
      setResolvedPromptVersion("fallback:evaluate@2026-05-12", true);
      const ctx = getCurrentLlmTraceContext();
      expect(ctx?.promptVersion).toBe("fallback:evaluate@2026-05-12");
      expect(ctx?.promptFallback).toBe(true);
    });
  });

  it("defaults fromFallback to false when omitted", async () => {
    await withLlmTrace(makeCtx({ promptVersion: "pending" }), () => {
      setResolvedPromptVersion("langfuse:3");
      expect(getCurrentLlmTraceContext()?.promptFallback).toBe(false);
    });
  });

  it("is idempotent — repeating with the same version is a no-op; repeating with a new version overwrites", async () => {
    await withLlmTrace(makeCtx({ promptVersion: "pending" }), () => {
      setResolvedPromptVersion("langfuse:7");
      setResolvedPromptVersion("langfuse:7");
      expect(getCurrentLlmTraceContext()?.promptVersion).toBe("langfuse:7");

      setResolvedPromptVersion("langfuse:8", false);
      expect(getCurrentLlmTraceContext()?.promptVersion).toBe("langfuse:8");
    });
  });

  it("is a no-op outside a withLlmTrace scope (does not throw)", () => {
    expect(() => setResolvedPromptVersion("langfuse:1")).not.toThrow();
    expect(getCurrentLlmTraceContext()).toBeUndefined();
  });

  it("mutation persists across awaited microtasks within the same scope", async () => {
    await withLlmTrace(makeCtx({ promptVersion: "pending" }), async () => {
      setResolvedPromptVersion("langfuse:5");
      await Promise.resolve();
      expect(getCurrentLlmTraceContext()?.promptVersion).toBe("langfuse:5");
    });
  });

  it("does not leak the mutation across concurrent withLlmTrace scopes", async () => {
    const [a, b] = await Promise.all([
      withLlmTrace(makeCtx({ promptVersion: "pending", requestId: "A" }), async () => {
        setResolvedPromptVersion("langfuse:A");
        await Promise.resolve();
        return getCurrentLlmTraceContext()?.promptVersion;
      }),
      withLlmTrace(makeCtx({ promptVersion: "pending", requestId: "B" }), async () => {
        setResolvedPromptVersion("langfuse:B");
        await Promise.resolve();
        return getCurrentLlmTraceContext()?.promptVersion;
      }),
    ]);
    expect(a).toBe("langfuse:A");
    expect(b).toBe("langfuse:B");
  });
});

// ---------------------------------------------------------------------------
// setResolvedPromptClient — Phase-2 ALS mutator (prompt-link wiring)
// ---------------------------------------------------------------------------

describe("setResolvedPromptClient", () => {
  it("mutates promptClient visible to subsequent getCurrentLlmTraceContext", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fakeClient = { name: "evaluate-system-prompt", version: 3 } as any;
    await withLlmTrace(makeCtx(), () => {
      expect(getCurrentLlmTraceContext()?.promptClient).toBeUndefined();

      setResolvedPromptClient(fakeClient);

      expect(getCurrentLlmTraceContext()?.promptClient).toBe(fakeClient);
    });
  });

  it("accepts null to clear (fallback / override path semantics)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fakeClient = { name: "x", version: 1 } as any;
    await withLlmTrace(makeCtx({ promptClient: fakeClient }), () => {
      expect(getCurrentLlmTraceContext()?.promptClient).toBe(fakeClient);
      setResolvedPromptClient(null);
      expect(getCurrentLlmTraceContext()?.promptClient).toBeNull();
    });
  });

  it("is a no-op outside a withLlmTrace scope (does not throw)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => setResolvedPromptClient({} as any)).not.toThrow();
    expect(() => setResolvedPromptClient(null)).not.toThrow();
    expect(getCurrentLlmTraceContext()).toBeUndefined();
  });

  it("does not leak the mutation across concurrent withLlmTrace scopes", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clientA = { name: "A" } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clientB = { name: "B" } as any;
    const [a, b] = await Promise.all([
      withLlmTrace(makeCtx({ requestId: "A" }), async () => {
        setResolvedPromptClient(clientA);
        await Promise.resolve();
        return getCurrentLlmTraceContext()?.promptClient;
      }),
      withLlmTrace(makeCtx({ requestId: "B" }), async () => {
        setResolvedPromptClient(clientB);
        await Promise.resolve();
        return getCurrentLlmTraceContext()?.promptClient;
      }),
    ]);
    expect(a).toBe(clientA);
    expect(b).toBe(clientB);
  });
});

// ---------------------------------------------------------------------------
// flushObservability / __resetForTests stubs (Task 4 no-ops)
// ---------------------------------------------------------------------------

describe("flushObservability", () => {
  it("resolves immediately when Langfuse is disabled (singleton null)", async () => {
    const t0 = Date.now();
    await flushObservability();
    // Generous bound so a slow CI box doesn't flake; the real point is
    // "this isn't blocking on a 200ms timeout".
    expect(Date.now() - t0).toBeLessThan(50);
  });

  it("accepts a timeout override without throwing", async () => {
    await expect(flushObservability(50)).resolves.toBeUndefined();
  });

  it("exposes LANGFUSE_FLUSH_TIMEOUT_MS = 200 (Req 6 AC 5)", () => {
    expect(LANGFUSE_FLUSH_TIMEOUT_MS).toBe(200);
  });

  it("calls Langfuse.flushAsync when the singleton exists", async () => {
    const flushAsync = vi.fn().mockResolvedValue(undefined);
    vi.mocked(Langfuse).mockImplementationOnce(function (
      this: { flushAsync: typeof flushAsync },
    ) {
      this.flushAsync = flushAsync;
    });
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";
    getLangfuse(); // instantiate the singleton

    await flushObservability();
    expect(flushAsync).toHaveBeenCalledTimes(1);
  });

  it("returns within `timeoutMs` even when flushAsync hangs (Req 6 AC 5)", async () => {
    // flushAsync never resolves — `Promise.race` against the timeout
    // must still let `flushObservability` return.
    vi.mocked(Langfuse).mockImplementationOnce(function (
      this: { flushAsync: () => Promise<void> },
    ) {
      this.flushAsync = () => new Promise<void>(() => {});
    });
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";
    getLangfuse();

    const t0 = Date.now();
    await flushObservability(50);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(200);
  });

  it("swallows flushAsync errors so observability never breaks the request (Req 7 AC 3)", async () => {
    vi.mocked(Langfuse).mockImplementationOnce(function (
      this: { flushAsync: () => Promise<void> },
    ) {
      this.flushAsync = vi.fn().mockRejectedValue(new Error("network down"));
    });
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";
    getLangfuse();

    // Spy installed AFTER getLangfuse so we only count warns produced by
    // the flush path itself (avoids any unrelated warnings emitted during
    // module init or in other tests' tail).
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(flushObservability()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("flushAsync failed");
    warnSpy.mockRestore();
  });
});

describe("__resetForTests", () => {
  it("is callable and returns undefined", () => {
    expect(__resetForTests()).toBeUndefined();
  });

  it("clears the warnedOnce flag so a second init failure warns again", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.mocked(Langfuse).mockImplementationOnce(function () {
      throw new Error("first failure");
    });
    getLangfuse();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    __resetForTests();

    vi.mocked(Langfuse).mockImplementationOnce(function () {
      throw new Error("second failure");
    });
    getLangfuse();
    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// TOOL_NAME_TO_FEATURE — cross-checked against the source-of-truth constants
// ---------------------------------------------------------------------------

describe("TOOL_NAME_TO_FEATURE", () => {
  // The map's keys are literal strings in observability.ts. This test
  // asserts they remain in sync with the per-surface tool-name exports
  // — a rename in either place fails loudly.
  const expected: ReadonlyArray<readonly [string, LlmFeature]> = [
    [EVALUATION_TOOL_NAME, "evaluate"],
    [ANNOTATE_TOOL_NAME, "annotate"],
    [READ_SPAN_TOOL_NAME, "annotate-span"],
    [TOOL_NAME_BY_TYPE.cloze, "generate"],
    [TOOL_NAME_BY_TYPE.translation, "generate"],
    [TOOL_NAME_BY_TYPE.vocab_recall, "generate"],
    [VALIDATION_TOOL_NAME, "validate"],
    [THEORY_TOOL_NAME, "generate-theory"],
    [THEORY_VALIDATION_TOOL_NAME, "validate-theory"],
  ];

  it("contains every tool name with the correct feature", () => {
    for (const [toolName, feature] of expected) {
      expect(TOOL_NAME_TO_FEATURE.get(toolName)).toBe(feature);
    }
  });

  it("has exactly the expected number of entries (no orphans)", () => {
    expect(TOOL_NAME_TO_FEATURE.size).toBe(expected.length);
  });

  it("every key is a non-empty string", () => {
    for (const key of TOOL_NAME_TO_FEATURE.keys()) {
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    }
  });
});
