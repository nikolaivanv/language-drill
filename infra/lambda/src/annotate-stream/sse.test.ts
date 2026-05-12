import { Writable } from "node:stream";
import { beforeEach, describe, expect, it } from "vitest";

import { createSseWriter } from "./sse";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
// `awslambda` is the runtime global the response-streaming Lambda receives.
// In tests we install a stub on `globalThis` that:
//  - records each `HttpResponseStream.from(...)` call (statusCode + headers)
//  - returns a fake Writable that collects all `.write(...)` bytes into a
//    string buffer (the SUT's wire bytes) and tracks whether `.end()` was
//    called.
// ---------------------------------------------------------------------------

type FromCall = {
  statusCode: number;
  headers?: Record<string, string>;
};

type SseHarness = {
  fromCalls: FromCall[];
  // bytes written via the underlying stream BEFORE `HttpResponseStream.from`
  // wraps it (currently unused — `openSse` is always called first — but kept
  // so a future test can assert).
  rawWrites: string[];
  // bytes written via whichever writable the SUT was holding when it called
  // `.write(...)`. The harness pushes one entry per call to the wrapped
  // stream's write.
  wrappedWrites: string[];
  ended: boolean;
};

function installHarness(): { stream: Writable; harness: SseHarness } {
  const harness: SseHarness = {
    fromCalls: [],
    rawWrites: [],
    wrappedWrites: [],
    ended: false,
  };

  const stream = new Writable({
    write(chunk, _enc, cb) {
      harness.rawWrites.push(chunk.toString("utf8"));
      cb();
    },
  });

  (globalThis as unknown as { awslambda: unknown }).awslambda = {
    HttpResponseStream: {
      from(_underlying: Writable, prelude: FromCall): Writable {
        harness.fromCalls.push({
          statusCode: prelude.statusCode,
          headers: prelude.headers,
        });
        return new Writable({
          write(chunk, _e, cb) {
            harness.wrappedWrites.push(chunk.toString("utf8"));
            cb();
          },
          final(cb) {
            harness.ended = true;
            cb();
          },
        });
      },
    },
    streamifyResponse: <T>(fn: T) => fn,
  };

  return { stream, harness };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createSseWriter — openSse + SSE headers (Req 3.1)", () => {
  let stream: Writable;
  let harness: SseHarness;

  beforeEach(() => {
    ({ stream, harness } = installHarness());
  });

  it("opens the stream with statusCode 200 and the four SSE headers", () => {
    const writer = createSseWriter(stream);
    writer.openSse();

    expect(harness.fromCalls).toHaveLength(1);
    expect(harness.fromCalls[0].statusCode).toBe(200);

    const headers = harness.fromCalls[0].headers ?? {};
    expect(headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(headers["cache-control"]).toBe("no-cache, no-transform");
    expect(headers["connection"]).toBe("keep-alive");
    expect(headers["x-accel-buffering"]).toBe("no");
  });
});

describe("createSseWriter — writeEvent / writeTerminal framing (Req 3.3)", () => {
  let stream: Writable;
  let harness: SseHarness;

  beforeEach(() => {
    ({ stream, harness } = installHarness());
  });

  it("writeEvent('meta', payload) emits one `event: meta\\ndata: <json>\\n\\n` frame", () => {
    const writer = createSseWriter(stream);
    writer.openSse();
    writer.writeEvent("meta", { calibration: { cefr: "B1", top: 3000 }, candidateCount: 7 });

    expect(harness.wrappedWrites).toHaveLength(1);
    expect(harness.wrappedWrites[0]).toBe(
      `event: meta\ndata: ${JSON.stringify({ calibration: { cefr: "B1", top: 3000 }, candidateCount: 7 })}\n\n`,
    );
  });

  it("writeEvent('flag', payload) emits one `event: flag\\ndata: <json>\\n\\n` frame", () => {
    const writer = createSseWriter(stream);
    writer.openSse();
    writer.writeEvent("flag", { matchedForm: "aldea", lemma: "aldea" });

    expect(harness.wrappedWrites).toHaveLength(1);
    expect(harness.wrappedWrites[0]).toBe(
      `event: flag\ndata: ${JSON.stringify({ matchedForm: "aldea", lemma: "aldea" })}\n\n`,
    );
  });

  it("writeTerminal('done', payload) emits the frame AND flips `terminated`", () => {
    const writer = createSseWriter(stream);
    writer.openSse();

    expect(writer.terminated).toBe(false);
    writer.writeTerminal("done", { flaggedCount: 5 });
    expect(writer.terminated).toBe(true);

    expect(harness.wrappedWrites).toHaveLength(1);
    expect(harness.wrappedWrites[0]).toBe(
      `event: done\ndata: ${JSON.stringify({ flaggedCount: 5 })}\n\n`,
    );
  });

  it("two writeTerminal calls — the second throws (at-most-one-terminal invariant)", () => {
    const writer = createSseWriter(stream);
    writer.openSse();
    writer.writeTerminal("done", { flaggedCount: 1 });

    expect(() =>
      writer.writeTerminal("error", { code: "AI_UNAVAILABLE", message: "x" }),
    ).toThrow(/already terminated/);

    // The error attempt MUST NOT have written a second frame.
    expect(harness.wrappedWrites).toHaveLength(1);
  });

  it("writeEvent after writeTerminal throws (cannot emit non-terminal after done)", () => {
    const writer = createSseWriter(stream);
    writer.openSse();
    writer.writeTerminal("done", { flaggedCount: 0 });

    expect(() => writer.writeEvent("flag", { matchedForm: "x" })).toThrow(
      /after terminal event/,
    );
  });

  it("writeEvent before openSse throws (fail-loud bug guard)", () => {
    const writer = createSseWriter(stream);
    expect(() => writer.writeEvent("meta", {})).toThrow(/before openSse/);
  });

  it("writeTerminal before openSse throws", () => {
    const writer = createSseWriter(stream);
    expect(() => writer.writeTerminal("done", { flaggedCount: 0 })).toThrow(
      /before openSse/,
    );
  });

  it("close() resolves only after the underlying stream emits 'finish'", async () => {
    const writer = createSseWriter(stream);
    writer.openSse();
    writer.writeTerminal("done", { flaggedCount: 0 });

    // `harness.ended` flips inside the underlying Writable's `final` callback;
    // that callback is what `stream.end(cb)` invokes. The Promise returned by
    // `close()` must resolve *after* that — i.e. once 'finish' is emitted.
    // Without the explicit await, the AWS runtime closes the socket on
    // handler-resolve and the last frame can be dropped client-side.
    expect(harness.ended).toBe(false);
    await writer.close();
    expect(harness.ended).toBe(true);
  });
});

describe("createSseWriter — errorJson (non-SSE branch)", () => {
  let stream: Writable;
  let harness: SseHarness;

  beforeEach(() => {
    ({ stream, harness } = installHarness());
  });

  it("errorJson(429, body) opens application/json, writes the JSON body, ends the stream", () => {
    const writer = createSseWriter(stream);
    writer.errorJson(429, { code: "RATE_LIMIT_EXCEEDED", message: "Daily evaluation limit exceeded" });

    expect(harness.fromCalls).toHaveLength(1);
    expect(harness.fromCalls[0].statusCode).toBe(429);
    expect(harness.fromCalls[0].headers).toEqual({
      "content-type": "application/json",
    });

    // The bytes are pure JSON — no `event: …\ndata: …` framing.
    expect(harness.wrappedWrites).toHaveLength(1);
    expect(harness.wrappedWrites[0]).toBe(
      JSON.stringify({ code: "RATE_LIMIT_EXCEEDED", message: "Daily evaluation limit exceeded" }),
    );
    expect(harness.wrappedWrites[0]).not.toContain("event:");
    expect(harness.wrappedWrites[0]).not.toContain("data:");

    expect(harness.ended).toBe(true);
  });

  it("errorJson works independently of openSse — it's the pre-stream error branch", () => {
    const writer = createSseWriter(stream);
    writer.errorJson(401, { code: "MISSING_SUB", message: "Unauthorized" });

    expect(harness.fromCalls).toHaveLength(1);
    expect(harness.fromCalls[0].statusCode).toBe(401);
    expect(writer.terminated).toBe(false); // `terminated` is an SSE-branch flag
  });
});

describe("createSseWriter — cors200 (OPTIONS fallback)", () => {
  let stream: Writable;
  let harness: SseHarness;

  beforeEach(() => {
    ({ stream, harness } = installHarness());
  });

  it("returns 204 with permissive Access-Control headers", () => {
    const writer = createSseWriter(stream);
    writer.cors200();

    expect(harness.fromCalls).toHaveLength(1);
    expect(harness.fromCalls[0].statusCode).toBe(204);

    const headers = harness.fromCalls[0].headers ?? {};
    expect(headers["access-control-allow-origin"]).toBe("*");
    expect(headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
    expect(headers["access-control-allow-headers"]).toBe(
      "Authorization, Content-Type",
    );

    expect(harness.ended).toBe(true);
  });
});
