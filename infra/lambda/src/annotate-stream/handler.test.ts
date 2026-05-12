import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted above all imports.
// ---------------------------------------------------------------------------

// Hoisted mocks driven per-test. `streamAnnotationImpl` is the active async
// generator factory; tests swap it via `setStreamAnnotation(...)`.
const {
  mockVerifyClerkJwt,
  mockBuildCandidateList,
  mockUsageCount,
  mockUsageInsertValues,
  streamAnnotationImpl,
} = vi.hoisted(() => {
  let impl: (() => AsyncIterable<unknown>) | null = null;
  return {
    mockVerifyClerkJwt: vi.fn(),
    mockBuildCandidateList: vi.fn(),
    mockUsageCount: vi.fn(),
    mockUsageInsertValues: vi.fn(),
    streamAnnotationImpl: {
      set(fn: () => AsyncIterable<unknown>) {
        impl = fn;
      },
      get(): AsyncIterable<unknown> {
        if (!impl) {
          throw new Error("streamAnnotation called but no impl was set");
        }
        return impl();
      },
    },
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
  return {
    createClaudeClient: vi.fn(() => ({})),
    streamAnnotation: () => streamAnnotationImpl.get(),
    AnnotateStreamMaxTokensError: AnnotateStreamMaxTokensErrorStub,
    loadFrequency: () => ({
      lookup: () => null,
      isStopword: () => false,
    }),
  };
});

vi.mock("@language-drill/db", () => ({
  usageEvents: { __mock: "usageEvents" },
}));

vi.mock("../db", () => {
  const usageWhere = () => ({
    then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
      return Promise.resolve(mockUsageCount()).then(resolve, reject);
    },
  });
  return {
    db: {
      select: () => ({ from: () => ({ where: usageWhere }) }),
      insert: () => ({
        values: (row: unknown) => {
          mockUsageInsertValues(row);
          return Promise.resolve();
        },
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
import { handler } from "./handler";
import type { LambdaFunctionURLEvent } from "aws-lambda";

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

beforeEach(() => {
  resetHarness();
  mockVerifyClerkJwt.mockReset().mockResolvedValue("user_123");
  mockBuildCandidateList.mockReset();
  mockUsageCount.mockReset().mockResolvedValue([{ count: 5 }]);
  mockUsageInsertValues.mockReset();
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
  it("rate-limit (429) returns JSON, not SSE", async () => {
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
      message: "Daily evaluation limit exceeded",
    });
    expect(mockBuildCandidateList).not.toHaveBeenCalled();
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
