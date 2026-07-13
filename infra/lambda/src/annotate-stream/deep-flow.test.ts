import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted above the SUT import.
// ---------------------------------------------------------------------------
// `dbResults` is a FIFO queue of rows-arrays: each Drizzle `select().from()
// .where()[.limit()]` chain shifts the next entry. The deep flow issues up to
// three queries in order — cache (only if `entryId`), rate-limit, profile — so
// each test enqueues exactly the rows those queries should resolve to.
const { dbResults, dbUpdates, dbInserts } = vi.hoisted(() => ({
  dbResults: [] as unknown[][],
  dbUpdates: [] as unknown[],
  dbInserts: [] as unknown[],
}));

vi.mock("../db", () => {
  const makeChain = () => {
    const rows = dbResults.shift() ?? [];
    const result = {
      limit: () => Promise.resolve(rows),
      then: (
        resolve: (v: unknown) => void,
        reject: (e: unknown) => void,
      ) => Promise.resolve(rows).then(resolve, reject),
    };
    return result;
  };
  return {
    db: {
      select: () => ({ from: () => ({ where: () => makeChain() }) }),
      update: () => ({
        set: (vals: unknown) => ({
          where: () => {
            dbUpdates.push(vals);
            return Promise.resolve();
          },
        }),
      }),
      insert: () => ({
        values: (row: unknown) => {
          dbInserts.push(row);
          return Promise.resolve();
        },
      }),
    },
  };
});

vi.mock("@language-drill/db", () => ({
  readEntries: { id: "id", userId: "user_id", spanAnnotations: "span_annotations" },
  usageEvents: { userId: "user_id", eventType: "event_type", createdAt: "created_at" },
  userLanguageProfiles: { userId: "user_id", language: "language", proficiencyLevel: "proficiency_level" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  gte: (...args: unknown[]) => args,
  count: () => "count_expr",
  sql: (strings: TemplateStringsArray, ...exprs: unknown[]) => ({ strings, exprs }),
}));

// `streamSpanImpl` is the active async-generator factory; tests swap it via
// `streamSpanImpl.set(...)`. `read-span-utils`' `resolveSpanType` only imports
// a TYPE from `@language-drill/ai`, so mocking the module here doesn't affect
// span-type resolution in the pre-model tests.
const { streamSpanImpl } = vi.hoisted(() => {
  type Impl = (client?: unknown, input?: unknown) => AsyncIterable<unknown>;
  let impl: Impl | null = null;
  return {
    streamSpanImpl: {
      set(fn: Impl) {
        impl = fn;
      },
      get(client?: unknown, input?: unknown): AsyncIterable<unknown> {
        if (!impl) throw new Error("streamSpan called but no impl was set");
        return impl(client, input);
      },
    },
  };
});

vi.mock("@language-drill/ai", () => {
  class ReadSpanStreamMaxTokensErrorStub extends Error {
    constructor(public readonly emittedFields: number) {
      super(`max_tokens after ${emittedFields}`);
      this.name = "ReadSpanStreamMaxTokensError";
    }
  }
  return {
    createObservedClaudeClient: vi.fn(() => ({})),
    streamSpan: (client: unknown, input: unknown) => streamSpanImpl.get(client, input),
    withLlmTrace: <T>(_ctx: unknown, fn: () => T | Promise<T>) => Promise.resolve(fn()),
    READ_SPAN_PROMPT_VERSION: "read-span@test",
    ReadSpanStreamMaxTokensError: ReadSpanStreamMaxTokensErrorStub,
  };
});

// Tier resolution + global brake (Task 7). `limitFor` is the REAL module so the
// tier-aware cap (free 150 / boosted 1500) is exercised end to end; only the
// plan resolver and the global brake are stubbed.
vi.mock("../usage/plan", () => ({
  getEffectivePlan: vi.fn(async () => "free"),
  isAdmin: vi.fn(() => false),
}));
vi.mock("../usage/global-capacity", () => ({
  checkGlobalCapacity: vi.fn(async () => "ok"),
}));

// Gloss-cache write-through (Task 5). Only `upsertGlossCacheRows` is exercised
// by this file's tests; stub it in isolation so the deep flow's best-effort
// write-through can be asserted without touching the real db-backed module.
const { mockUpsertGlossCacheRows } = vi.hoisted(() => ({
  mockUpsertGlossCacheRows: vi.fn(),
}));
vi.mock("./gloss-cache", () => ({
  upsertGlossCacheRows: mockUpsertGlossCacheRows,
}));

import { runDeepSpanPreModel, handleDeepSpan } from "./deep-flow";
import type { HandleDeepSpanArgs } from "./deep-flow";
import { CefrLevel, Language } from "@language-drill/shared";
import { ReadSpanStreamMaxTokensError } from "@language-drill/ai";
import { getEffectivePlan } from "../usage/plan";
import { checkGlobalCapacity } from "../usage/global-capacity";
import type { ResponseStream, SseWriter } from "./sse";

// ---------------------------------------------------------------------------
// Fake SSE writer — records every call so tests can assert framing + terminals.
// ---------------------------------------------------------------------------

type WriterCalls = {
  opened: number;
  events: Array<{ type: string; payload: unknown }>;
  terminals: Array<{ type: string; payload: unknown }>;
  errorJson: Array<{ status: number; body: object }>;
  cors200: number;
  closed: number;
};

function makeWriter(): { writer: SseWriter; calls: WriterCalls } {
  const calls: WriterCalls = {
    opened: 0,
    events: [],
    terminals: [],
    errorJson: [],
    cors200: 0,
    closed: 0,
  };
  let terminated = false;
  const writer: SseWriter = {
    openSse() {
      calls.opened++;
    },
    writeEvent(type, payload) {
      calls.events.push({ type, payload });
    },
    writeTerminal(type, payload) {
      calls.terminals.push({ type, payload });
      terminated = true;
    },
    async errorJson(status, body) {
      calls.errorJson.push({ status, body });
    },
    async cors200() {
      calls.cors200++;
    },
    async close() {
      calls.closed++;
    },
    get terminated() {
      return terminated;
    },
  };
  return { writer, calls };
}

const PASSAGE = "La aldea recibió al pintor.";

function buildArgs(
  overrides: Partial<HandleDeepSpanArgs["request"]> = {},
  writer?: SseWriter,
): HandleDeepSpanArgs {
  const w = writer ?? makeWriter().writer;
  return {
    event: {
      requestContext: { requestId: "req_1" },
    } as HandleDeepSpanArgs["event"],
    responseStream: { on: () => {} } as unknown as ResponseStream,
    writer: w,
    userId: "user_1",
    learningLanguage: Language.ES,
    request: {
      text: PASSAGE,
      language: Language.ES,
      start: 3, // "aldea"
      end: 8,
      ...overrides,
    },
  };
}

beforeEach(() => {
  dbResults.length = 0;
  dbUpdates.length = 0;
  dbInserts.length = 0;
  vi.mocked(getEffectivePlan).mockReset().mockResolvedValue("free");
  vi.mocked(checkGlobalCapacity).mockReset().mockResolvedValue("ok");
  mockUpsertGlossCacheRows.mockReset();
});

/** An async generator yielding scripted `field` events then a terminal `done`. */
function scriptedStream(
  fields: Array<{ key: string; value: unknown }>,
  card: unknown,
) {
  return async function* () {
    for (const f of fields) yield { kind: "field", key: f.key, value: f.value };
    yield { kind: "done", card };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runDeepSpanPreModel — offset validation (Req 2.4)", () => {
  it("rejects start >= end with a 400 VALIDATION_ERROR and no SSE open", async () => {
    const { writer, calls } = makeWriter();
    const result = await runDeepSpanPreModel(
      buildArgs({ start: 8, end: 8 }, writer),
    );

    expect(result.proceed).toBe(false);
    expect(calls.errorJson).toHaveLength(1);
    expect(calls.errorJson[0].status).toBe(400);
    expect(calls.errorJson[0].body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls.opened).toBe(0);
    // No DB query should have run.
    expect(dbResults.length).toBe(0);
  });

  it("rejects end > text.length with a 400 VALIDATION_ERROR", async () => {
    const { writer, calls } = makeWriter();
    const result = await runDeepSpanPreModel(
      buildArgs({ start: 0, end: PASSAGE.length + 1 }, writer),
    );

    expect(result.proceed).toBe(false);
    expect(calls.errorJson[0].status).toBe(400);
    expect(calls.errorJson[0].body).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("runDeepSpanPreModel — cache hit (Req 2.1, 2.6)", () => {
  it("streams the cached card (field per key + done) with NO model call / NO meter", async () => {
    const cachedCard = {
      type: "word",
      headword: "aldea",
      definition: "a small village",
      example: "Visitamos la aldea.",
    };
    // cache query → the saved entry holds the "3:8" key.
    dbResults.push([{ spanAnnotations: { "3:8": cachedCard } }]);

    const { writer, calls } = makeWriter();
    const result = await runDeepSpanPreModel(
      buildArgs({ entryId: "11111111-1111-1111-1111-111111111111" }, writer),
    );

    expect(result.proceed).toBe(false);
    expect(calls.opened).toBe(1);
    // One `field` per top-level key, in object order.
    expect(calls.events.map((e) => e.type)).toEqual(["field", "field", "field", "field"]);
    expect(calls.events.map((e) => (e.payload as { key: string }).key)).toEqual([
      "type",
      "headword",
      "definition",
      "example",
    ]);
    // Terminal `done` carries the whole card.
    expect(calls.terminals).toHaveLength(1);
    expect(calls.terminals[0].type).toBe("done");
    expect(calls.terminals[0].payload).toEqual({ card: cachedCard });
    expect(calls.closed).toBe(1);
    // Cache hit consumed exactly the one queued (cache) query — no rate-limit
    // / profile query ran, so the queue would still hold them if enqueued.
    expect(dbResults.length).toBe(0);
  });

  it("falls through to the model stage on a cache MISS (entry owned, key absent)", async () => {
    dbResults.push([{ spanAnnotations: { "99:100": { type: "word" } } }]); // cache: wrong key
    dbResults.push([{ count: 0 }]); // rate-limit
    dbResults.push([{ proficiencyLevel: "B2" }]); // profile

    const result = await runDeepSpanPreModel(
      buildArgs({ entryId: "11111111-1111-1111-1111-111111111111" }),
    );

    expect(result).toEqual({
      proceed: true,
      spanType: "word",
      proficiencyLevel: CefrLevel.B2,
      key: "3:8",
    });
  });
});

describe("runDeepSpanPreModel — rate-limit (Req 2.3)", () => {
  it("returns 429 RATE_LIMIT_EXCEEDED at the free-tier limitFor cap (150) and does NOT query the profile", async () => {
    dbResults.push([{ count: 150 }]); // rate-limit at the free cap
    dbResults.push([{ proficiencyLevel: "B2" }]); // profile — must NOT be consumed

    const { writer, calls } = makeWriter();
    const result = await runDeepSpanPreModel(buildArgs({}, writer)); // no entryId → no cache query

    expect(result.proceed).toBe(false);
    expect(calls.errorJson).toHaveLength(1);
    expect(calls.errorJson[0].status).toBe(429);
    expect(calls.errorJson[0].body).toMatchObject({ code: "RATE_LIMIT_EXCEEDED" });
    // Profile query never ran — its row is still queued.
    expect(dbResults).toEqual([[{ proficiencyLevel: "B2" }]]);
  });

  it("proceeds when the count is just under the free cap (149)", async () => {
    dbResults.push([{ count: 149 }]);
    dbResults.push([{ proficiencyLevel: "B1" }]);

    const result = await runDeepSpanPreModel(buildArgs({}));
    expect(result.proceed).toBe(true);
  });

  it("boosted user passes the free 150 cap (count 200 → proceeds, < boosted 1500)", async () => {
    vi.mocked(getEffectivePlan).mockResolvedValueOnce("boosted");
    dbResults.push([{ count: 200 }]); // > free 150, < boosted 1500
    dbResults.push([{ proficiencyLevel: "B1" }]); // profile

    const result = await runDeepSpanPreModel(buildArgs({}));
    expect(result.proceed).toBe(true);
  });

  it("global capacity 'capped' → 503 GLOBAL_CAPACITY before the count query", async () => {
    vi.mocked(checkGlobalCapacity).mockResolvedValueOnce("capped");
    // Queue rows the rate-limit + profile queries would consume — they must NOT run.
    dbResults.push([{ count: 0 }]);
    dbResults.push([{ proficiencyLevel: "B1" }]);

    const { writer, calls } = makeWriter();
    const result = await runDeepSpanPreModel(buildArgs({}, writer));

    expect(result.proceed).toBe(false);
    expect(calls.errorJson).toHaveLength(1);
    expect(calls.errorJson[0].status).toBe(503);
    expect(calls.errorJson[0].body).toMatchObject({ code: "GLOBAL_CAPACITY" });
    // Guard runs BEFORE the per-user count query: both rows are still queued.
    expect(dbResults).toEqual([[{ count: 0 }], [{ proficiencyLevel: "B1" }]]);
  });
});

describe("runDeepSpanPreModel — CEFR profile fallback (B1)", () => {
  it("uses the stored level when present and valid", async () => {
    dbResults.push([{ count: 0 }]);
    dbResults.push([{ proficiencyLevel: "C1" }]);

    const result = await runDeepSpanPreModel(buildArgs({}));
    expect(result).toMatchObject({ proceed: true, proficiencyLevel: CefrLevel.C1 });
  });

  it("falls back to B1 when no profile row exists", async () => {
    dbResults.push([{ count: 0 }]);
    dbResults.push([]); // no profile row

    const result = await runDeepSpanPreModel(buildArgs({}));
    expect(result).toMatchObject({ proceed: true, proficiencyLevel: CefrLevel.B1 });
  });

  it("falls back to B1 when the stored level is not a valid CEFR band", async () => {
    dbResults.push([{ count: 0 }]);
    dbResults.push([{ proficiencyLevel: "Z9" }]);

    const result = await runDeepSpanPreModel(buildArgs({}));
    expect(result).toMatchObject({ proceed: true, proficiencyLevel: CefrLevel.B1 });
  });
});

describe("runDeepSpanPreModel — span type resolution", () => {
  it("resolves a multi-word non-sentence selection to a phrase", async () => {
    dbResults.push([{ count: 0 }]);
    dbResults.push([{ proficiencyLevel: "B1" }]);

    // "aldea recibió" — two words, not a full sentence.
    const result = await runDeepSpanPreModel(buildArgs({ start: 3, end: 16 }));
    expect(result).toMatchObject({ proceed: true, spanType: "phrase", key: "3:16" });
  });
});

describe("handleDeepSpan — pre-model short-circuit", () => {
  it("returns without entering the model stage when the pre-model gate fails", async () => {
    const { writer, calls } = makeWriter();
    await expect(
      handleDeepSpan(buildArgs({ start: 5, end: 5 }, writer)),
    ).resolves.toBeUndefined();
    // Validation error path → errorJson, never opened SSE, never metered.
    expect(calls.opened).toBe(0);
    expect(dbInserts).toHaveLength(0);
  });
});

describe("handleDeepSpan — model stage success (Req 1.x, 2.5, 2.6)", () => {
  const CARD = { type: "word", headword: "aldea", definition: "a small village" };

  it("streams fields → done, writes back, and meters one row for a SAVED entry", async () => {
    dbResults.push([]); // cache miss
    dbResults.push([{ count: 0 }]); // rate-limit
    dbResults.push([{ proficiencyLevel: "B1" }]); // profile
    streamSpanImpl.set(
      scriptedStream(
        [
          { key: "type", value: "word" },
          { key: "definition", value: "a small village" },
        ],
        CARD,
      ),
    );

    const { writer, calls } = makeWriter();
    await handleDeepSpan(
      buildArgs({ entryId: "11111111-1111-1111-1111-111111111111" }, writer),
    );

    expect(calls.opened).toBe(1);
    expect(calls.events.map((e) => e.type)).toEqual(["field", "field"]);
    expect(calls.terminals).toHaveLength(1);
    expect(calls.terminals[0]).toEqual({ type: "done", payload: { card: CARD } });
    // Write-back ran once (saved entry); meter wrote exactly one row.
    expect(dbUpdates).toHaveLength(1);
    expect(dbInserts).toHaveLength(1);
    expect(dbInserts[0]).toMatchObject({
      userId: "user_1",
      eventType: "read_span_annotation",
      metadata: { language: Language.ES, spanType: "word" },
    });
    expect(calls.closed).toBe(1);
  });

  it("does NOT write back for an UNSAVED passage but still meters one row", async () => {
    dbResults.push([{ count: 0 }]); // rate-limit (no cache query w/o entryId)
    dbResults.push([{ proficiencyLevel: "B1" }]); // profile
    streamSpanImpl.set(scriptedStream([{ key: "type", value: "word" }], CARD));

    const { writer, calls } = makeWriter();
    await handleDeepSpan(buildArgs({}, writer)); // no entryId

    expect(calls.terminals[0]).toEqual({ type: "done", payload: { card: CARD } });
    expect(dbUpdates).toHaveLength(0);
    expect(dbInserts).toHaveLength(1);
  });
});

describe("handleDeepSpan — model stage failure (Req 1.8, 2.6)", () => {
  function queueProceed() {
    dbResults.push([{ count: 0 }]); // rate-limit
    dbResults.push([{ proficiencyLevel: "B1" }]); // profile
  }

  it("emits a terminal AI_UNAVAILABLE error and NO meter when streamSpan throws", async () => {
    queueProceed();
    streamSpanImpl.set(async function* () {
      throw new Error("boom");
    });

    const { writer, calls } = makeWriter();
    await handleDeepSpan(buildArgs({}, writer));

    expect(calls.terminals).toHaveLength(1);
    expect(calls.terminals[0].type).toBe("error");
    expect(calls.terminals[0].payload).toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(dbInserts).toHaveLength(0); // no meter on failure
    expect(dbUpdates).toHaveLength(0);
    expect(calls.closed).toBe(1);
  });

  it("maps ReadSpanStreamMaxTokensError to a terminal AI_UNAVAILABLE error, no meter", async () => {
    queueProceed();
    streamSpanImpl.set(async function* () {
      throw new ReadSpanStreamMaxTokensError(1);
    });

    const { writer, calls } = makeWriter();
    await handleDeepSpan(buildArgs({}, writer));

    expect(calls.terminals[0].type).toBe("error");
    expect(calls.terminals[0].payload).toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(dbInserts).toHaveLength(0);
  });

  it("treats a stream that ends without a `done` card as a failure (no meter, no done)", async () => {
    queueProceed();
    // Fields but no terminal `done` — contract violation.
    streamSpanImpl.set(async function* () {
      yield { kind: "field", key: "type", value: "word" };
    });

    const { writer, calls } = makeWriter();
    await handleDeepSpan(buildArgs({}, writer));

    expect(calls.terminals).toHaveLength(1);
    expect(calls.terminals[0].type).toBe("error");
    expect(dbInserts).toHaveLength(0);
  });
});

describe("handleDeepSpan — gloss-cache write-through (base-gloss cache Task 5)", () => {
  it("writes a resolved word card baseGloss through to the gloss cache", async () => {
    dbResults.push([{ count: 0 }]); // rate-limit
    dbResults.push([{ proficiencyLevel: "B1" }]); // profile
    const card = {
      type: "word",
      surface: "bancos",
      lemma: "banco",
      pos: "noun",
      contextualSense: "financial institution",
      baseGloss: "bench; bank",
      definition: "...",
      definitionLabel: "Español",
      cefr: "B1",
      freq: 4200,
    };
    streamSpanImpl.set(scriptedStream([{ key: "type", value: "word" }], card));

    const { writer } = makeWriter();
    await handleDeepSpan(buildArgs({}, writer));

    expect(mockUpsertGlossCacheRows).toHaveBeenCalledTimes(1);
    expect(mockUpsertGlossCacheRows).toHaveBeenCalledWith([
      {
        language: Language.ES,
        lemma: "banco",
        baseGloss: "bench; bank",
        pos: "noun",
        cefr: "B1",
        freqRank: 4200,
        source: "deep",
        promptVersion: expect.any(String),
      },
    ]);
  });

  it("does not write when the resolved card has no baseGloss (older snapshot)", async () => {
    dbResults.push([{ count: 0 }]); // rate-limit
    dbResults.push([{ proficiencyLevel: "B1" }]); // profile
    const card = {
      type: "word",
      surface: "bancos",
      lemma: "banco",
      pos: "noun",
      contextualSense: "financial institution",
      definition: "...",
      definitionLabel: "Español",
      cefr: "B1",
      freq: 4200,
    };
    streamSpanImpl.set(scriptedStream([{ key: "type", value: "word" }], card));

    const { writer } = makeWriter();
    await handleDeepSpan(buildArgs({}, writer));

    expect(mockUpsertGlossCacheRows).not.toHaveBeenCalled();
  });
});
