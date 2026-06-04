import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted above all imports.
// ---------------------------------------------------------------------------

// Hoisted mocks driven per-test. `streamAnnotationImpl` is the active async
// generator factory; tests swap it via `setStreamAnnotation(...)`.
//
// `mockFlushObservability` + `mockWithLlmTrace` are hoisted so individual
// tests can assert on call counts and captured trace context (Task 14
// enforces the flush + trace-context contract for the streaming Lambda —
// Req 6.2 / Req 7.2).
const {
  mockVerifyClerkJwt,
  mockBuildCandidateList,
  mockUsageCount,
  mockUsageInsertValues,
  mockFlushObservability,
  mockWithLlmTrace,
  mockSelectWhereArgs,
  streamAnnotationImpl,
} = vi.hoisted(() => {
  // The impl optionally receives the same (client, input) the real
  // `streamAnnotation` does — tests that care about the abort signal (e.g.
  // the soft-deadline path) need it; tests that don't can still pass a
  // no-arg generator.
  type Impl = (
    client?: unknown,
    input?: { signal?: AbortSignal },
  ) => AsyncIterable<unknown>;
  let impl: Impl | null = null;
  return {
    mockVerifyClerkJwt: vi.fn(),
    mockBuildCandidateList: vi.fn(),
    mockUsageCount: vi.fn(),
    mockUsageInsertValues: vi.fn(),
    // Records the args passed to each `.where(...)` so the bucket-split test can
    // assert the skim count query filters on `read_annotation` only. It's an
    // array (one entry per `.where()` call); tests inspect `.at(-1)`.
    mockSelectWhereArgs: [] as unknown[],
    mockFlushObservability: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    // Transparent passthrough by default — Langfuse is disabled in vitest,
    // so this matches production no-op behaviour. Tests can `.mock.calls`
    // to inspect the captured `LlmTraceContext`.
    mockWithLlmTrace: vi.fn(
      <T>(_ctx: unknown, fn: () => T | Promise<T>): Promise<T> =>
        Promise.resolve(fn()),
    ),
    streamAnnotationImpl: {
      set(fn: Impl) {
        impl = fn;
      },
      get(
        client?: unknown,
        input?: { signal?: AbortSignal },
      ): AsyncIterable<unknown> {
        if (!impl) {
          throw new Error("streamAnnotation called but no impl was set");
        }
        return impl(client, input);
      },
    },
  };
});

// Deep-flow integration helpers (task 16): the deep flow is NOT mocked here —
// the real `handleDeepSpan` runs through the handler with `streamSpan` + DB
// mocked. `streamSpanImpl` is the swappable async-generator factory;
// `dbSelectQueue` feeds each deep `select().…where()[.limit()]` chain its rows
// (FIFO); `mockReadEntriesUpdate` records the write-back `set(...)`.
const { streamSpanImpl, dbSelectQueue, mockReadEntriesUpdate, mockStreamSpan } =
  vi.hoisted(() => {
    type Impl = (client?: unknown, input?: unknown) => AsyncIterable<unknown>;
    let impl: Impl | null = null;
    return {
      streamSpanImpl: {
        set(fn: Impl | null) {
          impl = fn;
        },
        get(client?: unknown, input?: unknown): AsyncIterable<unknown> {
          if (!impl) throw new Error("streamSpan called but no impl was set");
          return impl(client, input);
        },
      },
      dbSelectQueue: [] as unknown[][],
      mockReadEntriesUpdate: vi.fn(),
      // Records every `streamSpan(...)` call so tests can assert it ran
      // (real deep call) or didn't (cache hit / pre-model short-circuit).
      mockStreamSpan: vi.fn(),
    };
  });

vi.mock("./jwt", () => ({
  verifyClerkJwt: (h: string | undefined) => mockVerifyClerkJwt(h),
}));

vi.mock("./pipeline", () => ({
  buildCandidateList: (input: unknown) => mockBuildCandidateList(input),
}));

vi.mock("@language-drill/ai", () => {
  class AnnotateStreamMaxTokensErrorStub extends Error {
    readonly code = "MAX_TOKENS_TRUNCATED" as const;
    constructor(public readonly flaggedCount: number) {
      super(`max_tokens after ${flaggedCount}`);
      this.name = "AnnotateStreamMaxTokensError";
    }
  }
  class ReadSpanStreamMaxTokensErrorStub extends Error {
    constructor(public readonly emittedFields: number) {
      super(`read-span max_tokens after ${emittedFields}`);
      this.name = "ReadSpanStreamMaxTokensError";
    }
  }
  return {
    createClaudeClient: vi.fn(() => ({})),
    // Drop-in replacement for `createClaudeClient` post-Task 13; identical
    // shape (no Langfuse env vars in vitest → vanilla Anthropic in prod).
    createObservedClaudeClient: vi.fn(() => ({})),
    // Forward (client, input) so tests that need the abort signal (soft-
    // deadline path) can capture it via `streamAnnotationImpl.set`.
    streamAnnotation: (client: unknown, input: { signal?: AbortSignal }) =>
      streamAnnotationImpl.get(client, input),
    // Deep-flow streaming (task 16 integration): swappable like streamAnnotation.
    streamSpan: (client: unknown, input: unknown) => {
      mockStreamSpan();
      return streamSpanImpl.get(client, input);
    },
    AnnotateStreamMaxTokensError: AnnotateStreamMaxTokensErrorStub,
    ReadSpanStreamMaxTokensError: ReadSpanStreamMaxTokensErrorStub,
    loadFrequency: () => ({
      lookup: () => null,
      isStopword: () => false,
    }),
    // Trace + flush spies are hoisted (top of file) so individual tests
    // can assert on the captured `LlmTraceContext` and the per-invocation
    // flush count (Req 6.2 / Req 7.2).
    withLlmTrace: <T>(ctx: unknown, fn: () => T | Promise<T>) =>
      mockWithLlmTrace(ctx, fn),
    flushObservability: () => mockFlushObservability(),
    ANNOTATE_SYSTEM_PROMPT_VERSION: "annotate@test",
    READ_SPAN_PROMPT_VERSION: "read-span@test",
  };
});

vi.mock("@language-drill/db", () => ({
  usageEvents: { __mock: "usageEvents" },
  // The deep flow (real, not mocked) queries these two tables.
  readEntries: { id: "id", userId: "user_id", spanAnnotations: "span_annotations" },
  userLanguageProfiles: {
    userId: "user_id",
    language: "language",
    proficiencyLevel: "proficiency_level",
  },
}));

vi.mock("../db", () => {
  // Each `select().from().where()[.limit()]` chain resolves the next queued
  // rows (deep flow's cache/rate/profile queries push their own); when the
  // queue is empty it falls back to `mockUsageCount()` (the skim flow's single
  // rolling-count query). `.limit()` and direct-await each consume exactly one
  // entry, so a query never double-consumes.
  const nextSelectRows = (): Promise<unknown> =>
    dbSelectQueue.length
      ? Promise.resolve(dbSelectQueue.shift())
      : Promise.resolve(mockUsageCount());
  const selectWhere = (...whereArgs: unknown[]) => {
    mockSelectWhereArgs.push(whereArgs);
    return {
      limit: () => nextSelectRows(),
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        nextSelectRows().then(resolve, reject),
    };
  };
  return {
    db: {
      select: () => ({ from: () => ({ where: selectWhere }) }),
      insert: () => ({
        values: (row: unknown) => {
          mockUsageInsertValues(row);
          return Promise.resolve();
        },
      }),
      update: () => ({
        set: (vals: unknown) => ({
          where: () => {
            mockReadEntriesUpdate(vals);
            return Promise.resolve();
          },
        }),
      }),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  count: () => "count_expr",
  gte: (...args: unknown[]) => args,
  inArray: (...args: unknown[]) => args,
  sql: (strings: TemplateStringsArray, ...exprs: unknown[]) => ({ strings, exprs }),
}));

// Tier resolution + global brake (Task 6). `limitFor` is the REAL module so
// the per-bucket caps (read_annotation: 50 free / 500 boosted) are exercised
// for real; only the plan lookup and global-capacity verdict are stubbed.
vi.mock("../usage/plan", () => ({
  getEffectivePlan: vi.fn(async () => "free"),
  isAdmin: vi.fn(() => false),
}));
vi.mock("../usage/global-capacity", () => ({
  checkGlobalCapacity: vi.fn(async () => "ok"),
}));

// ---------------------------------------------------------------------------
// Stub `awslambda` global before importing the SUT. Must run via `vi.hoisted`
// so it's installed before vitest hoists the SUT import.
// ---------------------------------------------------------------------------

type FromCall = { statusCode: number; headers?: Record<string, string> };

const { harness } = vi.hoisted(() => {
  // Local require so the hoisted factory doesn't depend on top-level imports.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Writable: HoistedWritable } = require("node:stream") as typeof import("node:stream");

  const h: {
    fromCalls: FromCall[];
    writes: string[];
    ended: boolean;
  } = { fromCalls: [], writes: [], ended: false };

  (globalThis as unknown as { awslambda: unknown }).awslambda = {
    HttpResponseStream: {
      from(_underlying: unknown, prelude: FromCall): unknown {
        h.fromCalls.push({
          statusCode: prelude.statusCode,
          headers: prelude.headers,
        });
        return new HoistedWritable({
          write(chunk, _e, cb) {
            h.writes.push(chunk.toString("utf8"));
            cb();
          },
          final(cb) {
            h.ended = true;
            cb();
          },
        });
      },
    },
    streamifyResponse: <T>(fn: T) => fn,
  };

  return { harness: h };
});

function resetHarness(): void {
  harness.fromCalls = [];
  harness.writes = [];
  harness.ended = false;
}

// Import the SUT AFTER `vi.hoisted` has installed the global.
import { handler, AnnotateSpanStreamRequest } from "./handler";
import type { LambdaFunctionURLEvent } from "aws-lambda";
import { getEffectivePlan } from "../usage/plan";
import { checkGlobalCapacity } from "../usage/global-capacity";

// ---------------------------------------------------------------------------
// Per-test setup
// ---------------------------------------------------------------------------

const PASSAGE = "La aldea recibió al pintor con cierta indiferencia.";

const ALDEA_FLAG = {
  matchedForm: "aldea",
  lemma: "aldea",
  pos: "noun",
  gloss: "small village",
  example: "Visitamos la aldea ayer.",
  freq: 4200,
  cefr: "B2",
};
const INDIFERENCIA_FLAG = {
  matchedForm: "indiferencia",
  lemma: "indiferencia",
  pos: "noun",
  gloss: "indifference",
  example: "Su indiferencia me sorprendió.",
  freq: 5800,
  cefr: "B2",
};

function buildPostEvent(
  body: object,
  headers: Record<string, string> = {},
): LambdaFunctionURLEvent {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/",
    rawQueryString: "",
    headers: { authorization: "Bearer valid", ...headers },
    requestContext: {
      accountId: "anonymous",
      apiId: "fn-url",
      domainName: "x.lambda-url.eu-central-1.on.aws",
      domainPrefix: "x",
      http: {
        method: "POST",
        path: "/",
        protocol: "HTTP/1.1",
        sourceIp: "0.0.0.0",
        userAgent: "vitest",
      },
      requestId: "req-1",
      routeKey: "$default",
      stage: "$default",
      time: "now",
      timeEpoch: 0,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as LambdaFunctionURLEvent;
}

function makeResponseStream(): Writable {
  return new Writable({ write(_c, _e, cb) { cb(); } });
}

/** A POST event whose path targets a given route (sets both path fields). */
function buildPostEventAtPath(path: string, body: object): LambdaFunctionURLEvent {
  const event = buildPostEvent(body);
  event.rawPath = path;
  if (event.requestContext?.http) event.requestContext.http.path = path;
  return event;
}

beforeEach(() => {
  resetHarness();
  mockVerifyClerkJwt.mockReset().mockResolvedValue("user_123");
  mockBuildCandidateList.mockReset();
  mockUsageCount.mockReset().mockResolvedValue([{ count: 5 }]);
  mockUsageInsertValues.mockReset();
  mockReadEntriesUpdate.mockReset();
  mockStreamSpan.mockReset();
  mockSelectWhereArgs.length = 0;
  dbSelectQueue.length = 0;
  // Default: any unexpected streamSpan call fails loudly. Tests that exercise a
  // real deep call override this via `streamSpanImpl.set(...)`.
  streamSpanImpl.set(null);
  // `.mockReset()` strips the default implementation, so re-pin both spies
  // to their passthrough/no-op defaults. Call records start empty for each
  // test — the observability assertions below depend on this.
  mockFlushObservability.mockReset().mockImplementation(() => Promise.resolve());
  mockWithLlmTrace
    .mockReset()
    .mockImplementation(
      <T>(_ctx: unknown, fn: () => T | Promise<T>): Promise<T> =>
        Promise.resolve(fn()),
    );
  // Re-pin the tier/capacity stubs to their permissive defaults; individual
  // tests override with `.mockResolvedValueOnce(...)` to exercise the gate.
  vi.mocked(getEffectivePlan).mockReset().mockResolvedValue("free");
  vi.mocked(checkGlobalCapacity).mockReset().mockResolvedValue("ok");
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSseFrames(): Array<{ event: string; data: unknown }> {
  // Concatenate all SSE writes; split on the frame separator `\n\n`.
  const concatenated = harness.writes.join("");
  return concatenated
    .split("\n\n")
    .filter((frame) => frame.startsWith("event:"))
    .map((frame) => {
      const [evLine, dataLine] = frame.split("\n");
      return {
        event: evLine.slice("event: ".length),
        data: JSON.parse(dataLine.slice("data: ".length)),
      };
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("annotate-stream handler — happy path", () => {
  it("valid POST with two flags → meta, flag, flag, done; usage row inserted with candidateCount", async () => {
    mockBuildCandidateList.mockResolvedValueOnce({
      candidates: [
        { matchedForm: "aldea", lemma: "aldea" },
        { matchedForm: "indiferencia", lemma: "indiferencia" },
      ],
      calibration: { cefr: "B1", top: 3000 },
    });
    streamAnnotationImpl.set(async function* () {
      yield { kind: "flag", flag: ALDEA_FLAG };
      yield { kind: "flag", flag: INDIFERENCIA_FLAG };
      yield { kind: "done", flaggedCount: 2 };
    });

    await handler(
      buildPostEvent({ text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    const frames = parseSseFrames();
    expect(frames.map((f) => f.event)).toEqual(["meta", "flag", "flag", "done"]);
    expect((frames[0].data as { calibration: unknown }).calibration).toEqual({
      cefr: "B1",
      top: 3000,
    });
    expect((frames[0].data as { candidateCount: number }).candidateCount).toBe(2);
    expect(frames[3].data).toEqual({ flaggedCount: 2 });

    // SSE preamble has the correct status + cache header.
    expect(harness.fromCalls[0].statusCode).toBe(200);
    expect(harness.fromCalls[0].headers?.["cache-control"]).toBe(
      "no-cache, no-transform",
    );

    // usage_events row inserted exactly once with candidateCount + flaggedCount.
    expect(mockUsageInsertValues).toHaveBeenCalledTimes(1);
    const row = mockUsageInsertValues.mock.calls[0][0] as {
      userId: string;
      eventType: string;
      metadata: { candidateCount: number; flaggedCount: number; language: string };
    };
    expect(row.userId).toBe("user_123");
    expect(row.eventType).toBe("read_annotation");
    expect(row.metadata.candidateCount).toBe(2);
    expect(row.metadata.flaggedCount).toBe(2);
    expect(row.metadata.language).toBe("ES");
  });
});

describe("annotate-stream handler — empty candidates (Req 1.6 / 2.5)", () => {
  it("empty candidate list → meta + done; no Claude call; no usage row", async () => {
    mockBuildCandidateList.mockResolvedValueOnce({
      candidates: [],
      calibration: { cefr: "B2", top: 5000 },
    });
    // streamAnnotation impl is intentionally NOT set — calling it would throw.

    await handler(
      buildPostEvent({ text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    const frames = parseSseFrames();
    expect(frames.map((f) => f.event)).toEqual(["meta", "done"]);
    expect(frames[1].data).toEqual({ flaggedCount: 0 });

    expect(mockUsageInsertValues).not.toHaveBeenCalled();
  });

  it("all candidates filtered (post-filter empty) collapses to the same shape", async () => {
    // `buildCandidateList` returns empty whether the pre- or post-filter
    // empties the list — the handler can't tell the two cases apart from
    // outside the pipeline, and shouldn't.
    mockBuildCandidateList.mockResolvedValueOnce({
      candidates: [],
      calibration: { cefr: "B1", top: 3000 },
    });

    await handler(
      buildPostEvent({ text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    const frames = parseSseFrames();
    expect(frames.map((f) => f.event)).toEqual(["meta", "done"]);
    expect(mockUsageInsertValues).not.toHaveBeenCalled();
  });
});

describe("annotate-stream handler — pre-stream gates", () => {
  it("rate-limit (429) returns JSON, not SSE — free read_annotation bucket at 50", async () => {
    mockUsageCount.mockResolvedValueOnce([{ count: 50 }]);

    await handler(
      buildPostEvent({ text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    expect(harness.fromCalls).toHaveLength(1);
    expect(harness.fromCalls[0].statusCode).toBe(429);
    expect(harness.fromCalls[0].headers?.["content-type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(harness.writes[0])).toEqual({
      code: "RATE_LIMIT_EXCEEDED",
      message: "Daily annotation limit exceeded",
    });
    expect(mockBuildCandidateList).not.toHaveBeenCalled();

    // The bucket split: the rolling count query must filter on
    // `read_annotation` ONLY now — `ai_evaluation` no longer counts toward
    // the skim cap. The drizzle-orm mock returns `eq()` args verbatim, so the
    // where-clause `and(...)` carries the eventType `eq` tuple.
    const whereArgs = mockSelectWhereArgs.at(-1) as unknown[];
    const flat = JSON.stringify(whereArgs);
    expect(flat).toContain("read_annotation");
    expect(flat).not.toContain("ai_evaluation");
  });

  it("boosted user passes the free 50 cap (read_annotation count 60 → proceeds)", async () => {
    vi.mocked(getEffectivePlan).mockResolvedValueOnce("boosted");
    mockUsageCount.mockResolvedValueOnce([{ count: 60 }]); // > free 50, < boosted 500
    mockBuildCandidateList.mockResolvedValueOnce({
      candidates: [{ matchedForm: "aldea", lemma: "aldea" }],
      calibration: { cefr: "B1", top: 3000 },
    });
    streamAnnotationImpl.set(async function* () {
      yield { kind: "flag", flag: ALDEA_FLAG };
      yield { kind: "done", flaggedCount: 1 };
    });

    await handler(
      buildPostEvent({ text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    // Not rate-limited: the SSE stream opened (200) and reached `done`.
    expect(harness.fromCalls[0].statusCode).toBe(200);
    expect(parseSseFrames().at(-1)?.event).toBe("done");
    expect(mockBuildCandidateList).toHaveBeenCalledTimes(1);
  });

  it("global capacity 'capped' → 503 GLOBAL_CAPACITY before the count query", async () => {
    vi.mocked(checkGlobalCapacity).mockResolvedValueOnce("capped");

    await handler(
      buildPostEvent({ text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    expect(harness.fromCalls).toHaveLength(1);
    expect(harness.fromCalls[0].statusCode).toBe(503);
    expect(harness.fromCalls[0].headers?.["content-type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(harness.writes[0])).toEqual({
      code: "GLOBAL_CAPACITY",
      message: "AI temporarily at capacity",
    });
    // Guard runs BEFORE the per-user count query and the pipeline.
    expect(mockBuildCandidateList).not.toHaveBeenCalled();
    expect(mockUsageCount).not.toHaveBeenCalled();
  });

  it("invalid JWT returns JSON 401", async () => {
    mockVerifyClerkJwt.mockReset().mockResolvedValueOnce(null);

    await handler(
      buildPostEvent({ text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    expect(harness.fromCalls).toHaveLength(1);
    expect(harness.fromCalls[0].statusCode).toBe(401);
    expect(harness.fromCalls[0].headers?.["content-type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(harness.writes[0]).code).toBe("MISSING_SUB");
  });

  it("language=EN returns JSON 400 UNSUPPORTED_LANGUAGE", async () => {
    await handler(
      buildPostEvent({ text: PASSAGE, language: "EN" }),
      makeResponseStream(),
      {} as never,
    );

    expect(harness.fromCalls[0].statusCode).toBe(400);
    expect(JSON.parse(harness.writes[0]).code).toBe("UNSUPPORTED_LANGUAGE");
    expect(mockVerifyClerkJwt).not.toHaveBeenCalled();
  });

  it("malformed body returns JSON 400 VALIDATION_ERROR", async () => {
    const event = buildPostEvent({ text: "", language: "ES" });
    await handler(event, makeResponseStream(), {} as never);

    expect(harness.fromCalls[0].statusCode).toBe(400);
    expect(JSON.parse(harness.writes[0]).code).toBe("VALIDATION_ERROR");
  });

  it("OPTIONS preflight returns 204 with CORS headers (works for a *.vercel.app origin)", async () => {
    const event = buildPostEvent({}, { origin: "https://lang-drill-preview.vercel.app" });
    (event.requestContext as { http: { method: string } }).http.method =
      "OPTIONS";

    await handler(event, makeResponseStream(), {} as never);

    expect(harness.fromCalls).toHaveLength(1);
    expect(harness.fromCalls[0].statusCode).toBe(204);
    const headers = harness.fromCalls[0].headers ?? {};
    expect(headers["access-control-allow-origin"]).toBe("*");
    expect(headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
    expect(mockVerifyClerkJwt).not.toHaveBeenCalled();
  });
});

describe("annotate-stream handler — Claude failures (Req 3.3, 4.8, 4.9)", () => {
  it("mid-stream Claude throws → meta + partial flag + error; no done; no usage row", async () => {
    mockBuildCandidateList.mockResolvedValueOnce({
      candidates: [
        { matchedForm: "aldea", lemma: "aldea" },
        { matchedForm: "indiferencia", lemma: "indiferencia" },
      ],
      calibration: { cefr: "B1", top: 3000 },
    });
    streamAnnotationImpl.set(async function* () {
      yield { kind: "flag", flag: ALDEA_FLAG };
      throw new Error("upstream timeout");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await handler(
      buildPostEvent({ text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    const frames = parseSseFrames();
    expect(frames.map((f) => f.event)).toEqual(["meta", "flag", "error"]);
    expect((frames[2].data as { code: string }).code).toBe("AI_UNAVAILABLE");

    expect(mockUsageInsertValues).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("soft-deadline fires before Lambda timeout → error frame with passage-too-long message; no done; no usage row", async () => {
    // Simulate a Claude stream that takes longer than the 25 s soft-deadline.
    // Fake timers let us advance past it instantly; the iterator awaits the
    // signal so the deadline's `abort.abort()` is what surfaces as an
    // AbortError up the iterator chain.
    vi.useFakeTimers();

    mockBuildCandidateList.mockResolvedValueOnce({
      candidates: [{ matchedForm: "aldea", lemma: "aldea" }],
      calibration: { cefr: "B1", top: 3000 },
    });

    streamAnnotationImpl.set(async function* (
      _client?: unknown,
      input?: { signal?: AbortSignal },
    ) {
      await new Promise<void>((resolve, reject) => {
        if (input?.signal?.aborted) {
          reject(new Error("AbortError"));
          return;
        }
        input?.signal?.addEventListener("abort", () => {
          reject(new Error("AbortError"));
        });
      });
      // Unreachable — the abort path resolves the test before this yields.
      yield { kind: "flag", flag: ALDEA_FLAG };
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const handlerPromise = handler(
      buildPostEvent({ text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    // Advance past the 25 s soft-deadline. Timer fires → abort → iterator
    // rejects → handler catch block writes the friendlier error frame.
    await vi.advanceTimersByTimeAsync(25_000);
    await handlerPromise;

    const frames = parseSseFrames();
    expect(frames.map((f) => f.event)).toEqual(["meta", "error"]);
    const errorPayload = frames[1].data as { code: string; message: string };
    expect(errorPayload.code).toBe("AI_UNAVAILABLE");
    // The deadline-specific message — distinguishes from the generic catch
    // path, so the user sees the actionable hint instead of "Evaluation
    // temporarily unavailable".
    expect(errorPayload.message).toMatch(/longer than expected/i);
    expect(warnSpy).toHaveBeenCalledWith(
      "[annotate-stream] soft-deadline fired",
      expect.objectContaining({ thresholdMs: 25_000 }),
    );
    expect(mockUsageInsertValues).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it("max_tokens truncation → error with AI_UNAVAILABLE; no done; no usage row; logged as warn", async () => {
    mockBuildCandidateList.mockResolvedValueOnce({
      candidates: [{ matchedForm: "aldea", lemma: "aldea" }],
      calibration: { cefr: "A1", top: 750 },
    });

    // Import the stub error class from the mocked module so `instanceof`
    // matches the handler's branch.
    const ai = await import("@language-drill/ai");
    streamAnnotationImpl.set(async function* () {
      throw new ai.AnnotateStreamMaxTokensError(0);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await handler(
      buildPostEvent({ text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    const frames = parseSseFrames();
    expect(frames.map((f) => f.event)).toEqual(["meta", "error"]);
    expect((frames[1].data as { code: string }).code).toBe("AI_UNAVAILABLE");
    expect(warnSpy).toHaveBeenCalledWith(
      "[annotate-stream] max_tokens truncation",
      expect.objectContaining({ flaggedCount: 0 }),
    );
    expect(mockUsageInsertValues).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe("annotate-stream handler — usage insert resilience", () => {
  it("usage_events insert failure is logged but does NOT swallow the done event", async () => {
    mockBuildCandidateList.mockResolvedValueOnce({
      candidates: [{ matchedForm: "aldea", lemma: "aldea" }],
      calibration: { cefr: "B1", top: 3000 },
    });
    streamAnnotationImpl.set(async function* () {
      yield { kind: "flag", flag: ALDEA_FLAG };
    });
    mockUsageInsertValues.mockImplementationOnce(() => {
      throw new Error("Neon insert failed");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await handler(
      buildPostEvent({ text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    const frames = parseSseFrames();
    expect(frames.map((f) => f.event)).toEqual(["meta", "flag", "done"]);
    expect(errSpy).toHaveBeenCalledWith(
      "[annotate-stream] usage insert failed",
      expect.any(Error),
    );

    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Task 14: flush + trace-context contract (Req 6.2, 7.2)
// ---------------------------------------------------------------------------
//
// The handler wraps its entire body in `try { ... } finally { await
// flushObservability(); }` so every invocation — success, error, abort, or
// short-circuit gate — drains the Langfuse buffer exactly once before
// returning. The `withLlmTrace` scope around the Claude stream carries the
// per-call metadata the Anthropic Proxy reads from ALS to tag the emitted
// generation. The Proxy → Langfuse mapping itself is exercised by
// `packages/ai/src/observability.test.ts` (Task 9); these tests lock in
// the handler's contract with that package.

describe("annotate-stream handler — observability flush + trace context", () => {
  it("happy path: flushObservability is called exactly once after done", async () => {
    mockBuildCandidateList.mockResolvedValueOnce({
      candidates: [
        { matchedForm: "aldea", lemma: "aldea" },
        { matchedForm: "indiferencia", lemma: "indiferencia" },
      ],
      calibration: { cefr: "B1", top: 3000 },
    });
    streamAnnotationImpl.set(async function* () {
      yield { kind: "flag", flag: ALDEA_FLAG };
      yield { kind: "flag", flag: INDIFERENCIA_FLAG };
    });

    await handler(
      buildPostEvent({ text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    const frames = parseSseFrames();
    expect(frames.map((f) => f.event)).toEqual(["meta", "flag", "flag", "done"]);
    expect(mockFlushObservability).toHaveBeenCalledTimes(1);
  });

  it("Claude error path: flushObservability is called exactly once after error", async () => {
    mockBuildCandidateList.mockResolvedValueOnce({
      candidates: [{ matchedForm: "aldea", lemma: "aldea" }],
      calibration: { cefr: "B1", top: 3000 },
    });
    streamAnnotationImpl.set(async function* () {
      yield { kind: "flag", flag: ALDEA_FLAG };
      throw new Error("upstream timeout");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await handler(
      buildPostEvent({ text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    const frames = parseSseFrames();
    expect(frames.map((f) => f.event)).toEqual(["meta", "flag", "error"]);
    expect(mockFlushObservability).toHaveBeenCalledTimes(1);

    errSpy.mockRestore();
  });

  it("max_tokens truncation path: flushObservability is called exactly once after error", async () => {
    mockBuildCandidateList.mockResolvedValueOnce({
      candidates: [{ matchedForm: "aldea", lemma: "aldea" }],
      calibration: { cefr: "A1", top: 750 },
    });
    const ai = await import("@language-drill/ai");
    streamAnnotationImpl.set(async function* () {
      throw new ai.AnnotateStreamMaxTokensError(0);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await handler(
      buildPostEvent({ text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    expect(mockFlushObservability).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it("pre-stream gate (rate-limit 429): flushObservability still called exactly once", async () => {
    // Even the short-circuit paths must flush — they don't open a trace,
    // so the flush is a no-op in production, but the contract is "one
    // flush per Lambda invocation" regardless of outcome.
    mockUsageCount.mockResolvedValueOnce([{ count: 50 }]);

    await handler(
      buildPostEvent({ text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    expect(harness.fromCalls[0].statusCode).toBe(429);
    expect(mockFlushObservability).toHaveBeenCalledTimes(1);
    // No trace ever opened — the rate-limit gate short-circuits before
    // the Claude call.
    expect(mockWithLlmTrace).not.toHaveBeenCalled();
  });

  it("trace context carries candidateCount + feature=annotate + per-call metadata, capturing flaggedCount via the streamAnnotation run inside the scope", async () => {
    mockBuildCandidateList.mockResolvedValueOnce({
      candidates: [
        { matchedForm: "aldea", lemma: "aldea" },
        { matchedForm: "indiferencia", lemma: "indiferencia" },
      ],
      calibration: { cefr: "B1", top: 3000 },
    });
    streamAnnotationImpl.set(async function* () {
      yield { kind: "flag", flag: ALDEA_FLAG };
      yield { kind: "flag", flag: INDIFERENCIA_FLAG };
    });

    await handler(
      buildPostEvent({ text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    // One `withLlmTrace` scope per invocation — wraps the Claude stream
    // iteration. The Anthropic Proxy (mocked-out at this layer; verified
    // in observability.test.ts Task 9) reads ALS at the start of
    // `messages.stream` and finalizes the generation with `flaggedCount =
    // collected.length` at stream end.
    expect(mockWithLlmTrace).toHaveBeenCalledTimes(1);
    const ctx = mockWithLlmTrace.mock.calls[0]![0] as {
      feature: string;
      env: string;
      promptVersion: string;
      requestId: string;
      userId: string;
      language: string;
      cefrLevel: string;
      exerciseType: string;
      candidateCount: number;
    };
    expect(ctx.feature).toBe("annotate");
    expect(ctx.userId).toBe("user_123");
    expect(ctx.language).toBe("ES");
    expect(ctx.cefrLevel).toBe("B1");
    expect(ctx.exerciseType).toBe("reading");
    expect(ctx.promptVersion).toBe("annotate@test");
    expect(ctx.requestId).toBe("req-1");
    // candidateCount lives in the trace context directly (Req 2 AC 2).
    expect(ctx.candidateCount).toBe(2);

    // flaggedCount is captured by the Proxy at stream end (collected from
    // `content_block_delta` events — see observability.ts `wrapStream`).
    // At the handler-test layer we verify the same count reaches the
    // usage_events row, which proves the stream iteration completed inside
    // the trace scope.
    expect(mockUsageInsertValues).toHaveBeenCalledTimes(1);
    const row = mockUsageInsertValues.mock.calls[0][0] as {
      metadata: { candidateCount: number; flaggedCount: number };
    };
    expect(row.metadata.candidateCount).toBe(2);
    expect(row.metadata.flaggedCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AnnotateSpanStreamRequest schema (task 11, Req 2.2/2.4)
// ---------------------------------------------------------------------------
// Field-level shape only. The cross-field invariant (start < end <= length)
// is enforced by the deep flow (task 13a), not the schema, so this block
// covers only what the Zod object itself accepts/rejects.

describe("AnnotateSpanStreamRequest schema", () => {
  const valid = {
    text: "La aldea recibió al pintor.",
    language: "ES",
    start: 3,
    end: 8,
  };

  it("accepts a well-formed body without entryId (unsaved passage)", () => {
    const result = AnnotateSpanStreamRequest.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts a uuid entryId (saved entry)", () => {
    const result = AnnotateSpanStreamRequest.safeParse({
      ...valid,
      entryId: "11111111-1111-1111-1111-111111111111",
    });
    expect(result.success).toBe(true);
  });

  it("parses EN at the schema level (EN is rejected later as UNSUPPORTED_LANGUAGE, not a shape error)", () => {
    const result = AnnotateSpanStreamRequest.safeParse({ ...valid, language: "EN" });
    expect(result.success).toBe(true);
  });

  it("does NOT trim text — offsets must stay aligned to the exact string", () => {
    const padded = { ...valid, text: "  hi  " };
    const result = AnnotateSpanStreamRequest.safeParse(padded);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.text).toBe("  hi  ");
  });

  it("rejects empty text, negative/non-integer offsets, a non-uuid entryId, and missing fields", () => {
    expect(AnnotateSpanStreamRequest.safeParse({ ...valid, text: "" }).success).toBe(false);
    expect(AnnotateSpanStreamRequest.safeParse({ ...valid, start: -1 }).success).toBe(false);
    expect(AnnotateSpanStreamRequest.safeParse({ ...valid, end: 2.5 }).success).toBe(false);
    expect(
      AnnotateSpanStreamRequest.safeParse({ ...valid, entryId: "not-a-uuid" }).success,
    ).toBe(false);
    expect(AnnotateSpanStreamRequest.safeParse({ text: "hi", language: "ES" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Deep-span flow integration (task 16, Req 1.4–1.8, 2.1–2.7)
// ---------------------------------------------------------------------------
// The REAL `handleDeepSpan` runs through the handler; only `streamSpan` and
// the DB are mocked. These cover the full skim-vs-deep stitch end-to-end at
// the SSE wire boundary; per-branch logic is also unit-tested in
// `deep-flow.test.ts`.

const DEEP_CARD = {
  type: "word",
  headword: "aldea",
  definition: "a small village",
};

/** Drive `streamSpan` with scripted `field` events then a terminal `done`. */
function setSpanStream(
  fields: Array<{ key: string; value: unknown }>,
  card: unknown,
): void {
  streamSpanImpl.set(async function* () {
    for (const f of fields) yield { kind: "field", key: f.key, value: f.value };
    yield { kind: "done", card };
  });
}

/** A valid deep-span POST body (the "aldea" word span of PASSAGE). */
function deepBody(overrides: Record<string, unknown> = {}) {
  return { text: PASSAGE, language: "ES", start: 3, end: 8, ...overrides };
}

describe("annotate-stream handler — deep-flow integration", () => {
  it("real deep call: streams field→done, meters one read_span_annotation row, no write-back without entryId", async () => {
    dbSelectQueue.push([{ count: 0 }]); // rate-limit
    dbSelectQueue.push([{ proficiencyLevel: "B1" }]); // profile
    setSpanStream(
      [
        { key: "type", value: "word" },
        { key: "definition", value: "a small village" },
      ],
      DEEP_CARD,
    );

    await handler(
      buildPostEventAtPath("/read/annotate-span", deepBody()),
      makeResponseStream(),
      {} as never,
    );

    const frames = parseSseFrames();
    expect(frames.map((f) => f.event)).toEqual(["field", "field", "done"]);
    expect(frames[2].data).toEqual({ card: DEEP_CARD });
    // Streamed via the deep flow, not the skim pipeline.
    expect(mockStreamSpan).toHaveBeenCalledTimes(1);
    expect(mockBuildCandidateList).not.toHaveBeenCalled();
    // Exactly one usage row, on the dedicated event type; no write-back (unsaved).
    expect(mockUsageInsertValues).toHaveBeenCalledTimes(1);
    expect(mockUsageInsertValues.mock.calls[0][0]).toMatchObject({
      eventType: "read_span_annotation",
      metadata: { language: "ES", spanType: "word" },
    });
    expect(mockReadEntriesUpdate).not.toHaveBeenCalled();
    // Flush-once and a single terminal frame.
    expect(mockFlushObservability).toHaveBeenCalledTimes(1);
    expect(frames.filter((f) => f.event === "done" || f.event === "error")).toHaveLength(1);
  });

  it("saved entry: writes back to span_annotations exactly once", async () => {
    dbSelectQueue.push([]); // cache miss
    dbSelectQueue.push([{ count: 0 }]); // rate-limit
    dbSelectQueue.push([{ proficiencyLevel: "B1" }]); // profile
    setSpanStream([{ key: "type", value: "word" }], DEEP_CARD);

    await handler(
      buildPostEventAtPath(
        "/read/annotate-span",
        deepBody({ entryId: "11111111-1111-1111-1111-111111111111" }),
      ),
      makeResponseStream(),
      {} as never,
    );

    expect(mockStreamSpan).toHaveBeenCalledTimes(1);
    expect(mockReadEntriesUpdate).toHaveBeenCalledTimes(1);
    expect(mockUsageInsertValues).toHaveBeenCalledTimes(1);
  });

  it("cache hit: emits field+done from the stored card with NO streamSpan call and NO meter", async () => {
    // Saved entry already holds the "3:8" card.
    dbSelectQueue.push([{ spanAnnotations: { "3:8": DEEP_CARD } }]);

    await handler(
      buildPostEventAtPath(
        "/read/annotate-span",
        deepBody({ entryId: "11111111-1111-1111-1111-111111111111" }),
      ),
      makeResponseStream(),
      {} as never,
    );

    const frames = parseSseFrames();
    expect(frames.map((f) => f.event)).toEqual(["field", "field", "field", "done"]);
    expect(frames[3].data).toEqual({ card: DEEP_CARD });
    expect(mockStreamSpan).not.toHaveBeenCalled();
    expect(mockUsageInsertValues).not.toHaveBeenCalled();
    expect(mockReadEntriesUpdate).not.toHaveBeenCalled();
    expect(mockFlushObservability).toHaveBeenCalledTimes(1);
  });

  it("offset validation: start >= end → 400 VALIDATION_ERROR, no stream, flush-once", async () => {
    await handler(
      buildPostEventAtPath("/read/annotate-span", deepBody({ start: 8, end: 8 })),
      makeResponseStream(),
      {} as never,
    );

    expect(harness.fromCalls[0].statusCode).toBe(400);
    expect(JSON.parse(harness.writes[0])).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockStreamSpan).not.toHaveBeenCalled();
    expect(mockFlushObservability).toHaveBeenCalledTimes(1);
  });

  it("EN on the deep path → 400 UNSUPPORTED_LANGUAGE (deep schema gate 4)", async () => {
    await handler(
      buildPostEventAtPath("/read/annotate-span", deepBody({ language: "EN" })),
      makeResponseStream(),
      {} as never,
    );

    expect(harness.fromCalls[0].statusCode).toBe(400);
    expect(JSON.parse(harness.writes[0])).toMatchObject({ code: "UNSUPPORTED_LANGUAGE" });
    expect(mockStreamSpan).not.toHaveBeenCalled();
  });

  it("malformed deep body (missing offsets) → 400 VALIDATION_ERROR", async () => {
    await handler(
      buildPostEventAtPath("/read/annotate-span", { text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    expect(harness.fromCalls[0].statusCode).toBe(400);
    expect(JSON.parse(harness.writes[0])).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockStreamSpan).not.toHaveBeenCalled();
  });

  it("dedicated read_span_annotation rate-limit at 150 → 429, no stream, no meter", async () => {
    dbSelectQueue.push([{ count: 150 }]); // at the deep cap (NOT the skim 50)

    await handler(
      buildPostEventAtPath("/read/annotate-span", deepBody()),
      makeResponseStream(),
      {} as never,
    );

    expect(harness.fromCalls[0].statusCode).toBe(429);
    expect(JSON.parse(harness.writes[0])).toMatchObject({ code: "RATE_LIMIT_EXCEEDED" });
    expect(mockStreamSpan).not.toHaveBeenCalled();
    expect(mockUsageInsertValues).not.toHaveBeenCalled();
    expect(mockFlushObservability).toHaveBeenCalledTimes(1);
  });

  it("proceeds at 50 (the skim cap) — the deep bucket is independent", async () => {
    dbSelectQueue.push([{ count: 50 }]); // would block the skim flow; deep cap is 150
    dbSelectQueue.push([{ proficiencyLevel: "B1" }]);
    setSpanStream([{ key: "type", value: "word" }], DEEP_CARD);

    await handler(
      buildPostEventAtPath("/read/annotate-span", deepBody()),
      makeResponseStream(),
      {} as never,
    );

    expect(mockStreamSpan).toHaveBeenCalledTimes(1);
    expect(parseSseFrames().at(-1)?.event).toBe("done");
  });

  it("streamSpan abort/error → terminal error AI_UNAVAILABLE and NO meter", async () => {
    dbSelectQueue.push([{ count: 0 }]); // rate-limit
    dbSelectQueue.push([{ proficiencyLevel: "B1" }]); // profile
    streamSpanImpl.set(async function* () {
      throw new Error("aborted");
    });

    await handler(
      buildPostEventAtPath("/read/annotate-span", deepBody()),
      makeResponseStream(),
      {} as never,
    );

    const frames = parseSseFrames();
    expect(frames.at(-1)?.event).toBe("error");
    expect((frames.at(-1)?.data as { code: string }).code).toBe("AI_UNAVAILABLE");
    expect(mockUsageInsertValues).not.toHaveBeenCalled(); // no meter on abort
    expect(mockFlushObservability).toHaveBeenCalledTimes(1);
  });

  it("routes the bare base URL to the skim flow (buildCandidateList runs, streamSpan does not)", async () => {
    mockBuildCandidateList.mockResolvedValueOnce({
      candidates: [],
      calibration: { cefr: "B1", top: 3000 },
    });

    await handler(
      buildPostEventAtPath("/", { text: PASSAGE, language: "ES" }),
      makeResponseStream(),
      {} as never,
    );

    expect(mockBuildCandidateList).toHaveBeenCalledTimes(1);
    expect(mockStreamSpan).not.toHaveBeenCalled();
  });

  it("falls back to rawPath when requestContext.http.path is absent (deep)", async () => {
    dbSelectQueue.push([{ count: 0 }]);
    dbSelectQueue.push([{ proficiencyLevel: "B1" }]);
    setSpanStream([{ key: "type", value: "word" }], DEEP_CARD);

    const event = buildPostEvent(deepBody());
    event.rawPath = "/read/annotate-span";
    if (event.requestContext?.http) {
      (event.requestContext.http as { path?: string }).path = undefined;
    }

    await handler(event, makeResponseStream(), {} as never);

    expect(mockStreamSpan).toHaveBeenCalledTimes(1);
    expect(mockBuildCandidateList).not.toHaveBeenCalled();
  });
});
