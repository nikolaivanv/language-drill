/**
 * Unit tests for `eval-export.ts` (Phase 2 Tasks 22 + 23).
 *
 * Stubs both ports (`LangfuseDatasetApi` + `DbExerciseLookup`) so neither
 * the Langfuse SDK nor the Drizzle pool spins up. Covers the documented
 * Task-23 scenarios:
 *
 *   (a) 5 fixture traces, fresh dataset → 5 items created
 *   (b) 3 of 5 already in the dataset → 2 items created
 *   (c) one trace missing in Neon → logged + skipped, 4 items created
 *   (d) Langfuse outage on createDataset → orchestrator throws (CLI exits 1)
 *
 * Plus targeted coverage of the Task-22 primitives (tag construction,
 * mulberry32, uniformSample, pagination) and the dataset helpers
 * introduced in Task 23.
 */

import { describe, expect, it, vi } from "vitest";

import {
  buildExistingSubmissionIdSet,
  buildTagFilter,
  extractTraceMetadata,
  fetchAllEvaluateTraces,
  getOrCreateDataset,
  mulberry32,
  parseEvalExportArgs,
  runEvalExport,
  runEvalExportSampling,
  uniformSample,
  writeSampledTracesToDataset,
  type DbExerciseLookup,
  type EvalExportArgs,
  type FetchedTrace,
  type LangfuseDatasetApi,
  type LangfuseTraceApi,
} from "./eval-export";

// ---------------------------------------------------------------------------
// Tag construction (Task 22 primitive)
// ---------------------------------------------------------------------------

describe("buildTagFilter", () => {
  it("always pins feature:evaluate", () => {
    expect(buildTagFilter({})).toEqual(["feature:evaluate"]);
  });

  it("uppercases optional language and CEFR to match buildTraceMetadata output", () => {
    expect(buildTagFilter({ language: "es", cefr: "b1" })).toEqual([
      "feature:evaluate",
      "language:ES",
      "cefrLevel:B1",
    ]);
  });

  it("ignores empty-string filters (e.g. parseArgs default)", () => {
    expect(buildTagFilter({ language: "", cefr: "" })).toEqual([
      "feature:evaluate",
    ]);
  });
});

// ---------------------------------------------------------------------------
// mulberry32 (Task 22 primitive)
// ---------------------------------------------------------------------------

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("returns values in [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// uniformSample (Task 22 primitive)
// ---------------------------------------------------------------------------

describe("uniformSample", () => {
  it("returns min(n, items.length) elements", () => {
    const items = [1, 2, 3, 4, 5];
    expect(uniformSample(items, 3, mulberry32(1))).toHaveLength(3);
    expect(uniformSample(items, 99, mulberry32(1))).toHaveLength(5);
    expect(uniformSample(items, 0, mulberry32(1))).toHaveLength(0);
  });

  it("does not mutate the input array", () => {
    const items = [1, 2, 3, 4, 5];
    const frozen = items.slice();
    uniformSample(items, 3, mulberry32(1));
    expect(items).toEqual(frozen);
  });

  it("reproduces the same sample for the same seed", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    const s1 = uniformSample(items, 3, mulberry32(123));
    const s2 = uniformSample(items, 3, mulberry32(123));
    expect(s1).toEqual(s2);
  });

  it("produces a different ordering for different seeds (smoke)", () => {
    // Smoke check — adjacent seeds shouldn't produce identical orderings
    // for a 6-item slice. (Not a statistical test of uniformity.)
    const items = ["a", "b", "c", "d", "e", "f"];
    const s1 = uniformSample(items, 6, mulberry32(1));
    const s2 = uniformSample(items, 6, mulberry32(2));
    expect(s1).not.toEqual(s2);
  });
});

// ---------------------------------------------------------------------------
// fetchAllEvaluateTraces — pagination
// ---------------------------------------------------------------------------

describe("fetchAllEvaluateTraces", () => {
  it("paginates until a short page arrives", async () => {
    // Page 1 returns 1000 → page 2 returns 1000 → page 3 returns 3 (short).
    // We use small payloads here (1 row per page) and override the SDK page
    // size? No — the script uses the constant `TRACE_LIST_PAGE_SIZE = 1000`,
    // so to exercise pagination we need the mock to return exactly 1000-row
    // pages. Easier: stub returns a "full" page (1000 entries) twice, then
    // a partial page on call 3, then asserts the call count.
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      id: `t${i}`,
    })) as FetchedTrace[];
    const shortPage: FetchedTrace[] = [{ id: "tail-1" }, { id: "tail-2" }];
    const traceList = vi
      .fn()
      .mockResolvedValueOnce({ data: fullPage })
      .mockResolvedValueOnce({ data: shortPage });
    const langfuse: LangfuseTraceApi = { api: { traceList } };

    const all = await fetchAllEvaluateTraces({
      langfuse,
      tags: ["feature:evaluate"],
      fromTimestamp: "2026-05-10",
      toTimestamp: "2026-05-17",
    });

    expect(all).toHaveLength(1002);
    expect(traceList).toHaveBeenCalledTimes(2);
    expect(traceList).toHaveBeenNthCalledWith(1, {
      tags: ["feature:evaluate"],
      fromTimestamp: "2026-05-10",
      toTimestamp: "2026-05-17",
      page: 1,
      limit: 1000,
    });
  });

  it("returns an empty array when the first page is empty (no data)", async () => {
    const traceList = vi.fn().mockResolvedValue({ data: [] });
    const langfuse: LangfuseTraceApi = { api: { traceList } };

    const all = await fetchAllEvaluateTraces({
      langfuse,
      tags: ["feature:evaluate"],
      fromTimestamp: "2026-05-10",
      toTimestamp: "2026-05-17",
    });

    expect(all).toEqual([]);
    expect(traceList).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// parseEvalExportArgs
// ---------------------------------------------------------------------------

describe("parseEvalExportArgs", () => {
  it("parses every required arg + optional language/cefr/seed", () => {
    const parsed = parseEvalExportArgs([
      "--from",
      "2026-05-10",
      "--to",
      "2026-05-17",
      "--sample",
      "10",
      "--dataset",
      "eval-smoke",
      "--language",
      "es",
      "--cefr",
      "B1",
      "--seed",
      "42",
    ]);
    expect(parsed).toEqual({
      from: "2026-05-10",
      to: "2026-05-17",
      sample: 10,
      dataset: "eval-smoke",
      language: "es",
      cefr: "B1",
      seed: 42,
    });
  });

  it("throws when --from is missing", () => {
    expect(() =>
      parseEvalExportArgs([
        "--to",
        "2026-05-17",
        "--sample",
        "10",
        "--dataset",
        "eval-smoke",
      ]),
    ).toThrow(/--from/);
  });

  it("throws when --sample is non-numeric", () => {
    expect(() =>
      parseEvalExportArgs([
        "--from",
        "2026-05-10",
        "--to",
        "2026-05-17",
        "--sample",
        "abc",
        "--dataset",
        "eval-smoke",
      ]),
    ).toThrow(/--sample/);
  });

  it("throws when --seed is not an integer", () => {
    expect(() =>
      parseEvalExportArgs([
        "--from",
        "2026-05-10",
        "--to",
        "2026-05-17",
        "--sample",
        "10",
        "--dataset",
        "eval-smoke",
        "--seed",
        "1.5",
      ]),
    ).toThrow(/--seed/);
  });
});

// ---------------------------------------------------------------------------
// runEvalExportSampling — fetch + sample together
// ---------------------------------------------------------------------------

describe("runEvalExportSampling", () => {
  it("logs `fetched=N sampled=M tags=...` after sampling", async () => {
    const fetched: FetchedTrace[] = Array.from(
      { length: 8 },
      (_, i) => ({ id: `t${i}` }),
    );
    const traceList = vi.fn().mockResolvedValue({ data: fetched });
    const log = vi.fn();
    const args: EvalExportArgs = {
      from: "2026-05-10",
      to: "2026-05-17",
      sample: 3,
      dataset: "eval-smoke",
      seed: 42,
    };

    const result = await runEvalExportSampling(
      { api: { traceList } },
      args,
      log,
    );

    expect(result.fetchedCount).toBe(8);
    expect(result.sampled).toHaveLength(3);
    expect(result.tags).toEqual(["feature:evaluate"]);
    const summaryLog = log.mock.calls.find(
      (a) =>
        typeof a[0] === "string" && a[0].startsWith("[eval-export] fetched="),
    );
    expect(summaryLog).toBeDefined();
    expect(String(summaryLog![0])).toContain("fetched=8");
    expect(String(summaryLog![0])).toContain("sampled=3");
  });
});

// ---------------------------------------------------------------------------
// Task-23 helpers — metadata extraction, dedupe set, get-or-create dataset
// ---------------------------------------------------------------------------

describe("extractTraceMetadata", () => {
  it("returns empty when metadata is null/missing", () => {
    expect(extractTraceMetadata({ id: "t1" })).toEqual({});
    expect(extractTraceMetadata({ id: "t2", metadata: null })).toEqual({});
  });

  it("picks the five known fields and ignores non-strings", () => {
    expect(
      extractTraceMetadata({
        id: "t1",
        metadata: {
          submissionId: "sub-1",
          language: "ES",
          cefrLevel: "B1",
          exerciseType: "cloze",
          localPromptVersion: "evaluate@2026-05-12",
          // Junk that should be ignored:
          unrelated: 42,
          numericFieldSlot: 99,
        },
      }),
    ).toEqual({
      submissionId: "sub-1",
      language: "ES",
      cefrLevel: "B1",
      exerciseType: "cloze",
      localPromptVersion: "evaluate@2026-05-12",
    });
  });
});

describe("buildExistingSubmissionIdSet", () => {
  it("collects string submissionIds and skips malformed items", () => {
    const set = buildExistingSubmissionIdSet([
      { metadata: { submissionId: "a" } },
      { metadata: { submissionId: "b" } },
      { metadata: {} },
      { metadata: null },
      { metadata: { submissionId: 42 } },
      { metadata: { submissionId: "" } },
      {},
    ]);
    expect(Array.from(set).sort()).toEqual(["a", "b"]);
  });
});

describe("getOrCreateDataset", () => {
  it("returns existing items when the dataset already exists", async () => {
    const stub: LangfuseDatasetApi = {
      api: { traceList: vi.fn() },
      getDataset: vi.fn().mockResolvedValue({
        items: [{ metadata: { submissionId: "x" } }],
      }),
      createDataset: vi.fn(),
      createDatasetItem: vi.fn(),
    };
    const { existingItems } = await getOrCreateDataset(stub, "eval-smoke");
    expect(existingItems).toEqual([{ metadata: { submissionId: "x" } }]);
    expect(stub.createDataset).not.toHaveBeenCalled();
  });

  it("creates the dataset on 404 and returns an empty item list", async () => {
    const notFound = Object.assign(new Error("Dataset not found"), {
      status: 404,
    });
    const stub: LangfuseDatasetApi = {
      api: { traceList: vi.fn() },
      getDataset: vi.fn().mockRejectedValue(notFound),
      createDataset: vi.fn().mockResolvedValue({ id: "ds-1" }),
      createDatasetItem: vi.fn(),
    };
    const { existingItems } = await getOrCreateDataset(stub, "eval-smoke");
    expect(existingItems).toEqual([]);
    expect(stub.createDataset).toHaveBeenCalledWith({ name: "eval-smoke" });
  });

  it("rethrows non-404 getDataset errors (unknown SDK state is fatal)", async () => {
    const authErr = Object.assign(new Error("Unauthorized"), { status: 401 });
    const stub: LangfuseDatasetApi = {
      api: { traceList: vi.fn() },
      getDataset: vi.fn().mockRejectedValue(authErr),
      createDataset: vi.fn(),
      createDatasetItem: vi.fn(),
    };
    await expect(getOrCreateDataset(stub, "eval-smoke")).rejects.toBe(authErr);
    expect(stub.createDataset).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test fixtures for the Task-23 write paths
// ---------------------------------------------------------------------------

function makeTrace(
  submissionId: string,
  overrides: Partial<FetchedTrace> = {},
): FetchedTrace {
  return {
    id: `trace-${submissionId}`,
    output: { score: 0.8, feedback: `eval for ${submissionId}` },
    metadata: {
      submissionId,
      language: "ES",
      cefrLevel: "B1",
      exerciseType: "cloze",
      localPromptVersion: "evaluate@2026-05-12",
    },
    ...overrides,
  };
}

function makeDbStub(
  knownSubmissions: ReadonlyArray<string>,
): DbExerciseLookup {
  const set = new Set(knownSubmissions);
  return {
    lookupExerciseSubmission: vi.fn(async (id: string) => {
      if (!set.has(id)) return null;
      return {
        userAnswer: `answer-${id}`,
        exerciseContent: { type: "cloze", sentence: `Q for ${id}` },
        language: "ES",
        cefrLevel: "B1",
        exerciseType: "cloze",
      };
    }),
  };
}

function makeLangfuseStub(opts: {
  existingItems?: ReadonlyArray<{ metadata?: unknown }>;
  getDatasetThrows?: unknown;
  createDatasetThrows?: unknown;
  createDatasetItemThrows?: unknown;
  fetched?: ReadonlyArray<FetchedTrace>;
}): {
  langfuse: LangfuseDatasetApi;
  createDatasetItem: ReturnType<typeof vi.fn>;
  createDataset: ReturnType<typeof vi.fn>;
} {
  const traceList = vi.fn().mockResolvedValue({ data: opts.fetched ?? [] });
  const getDataset = vi.fn(async () => {
    if (opts.getDatasetThrows) throw opts.getDatasetThrows;
    return { items: opts.existingItems ?? [] };
  });
  const createDataset = vi.fn(async () => {
    if (opts.createDatasetThrows) throw opts.createDatasetThrows;
    return { id: "ds-1" };
  });
  const createDatasetItem = vi.fn(async () => {
    if (opts.createDatasetItemThrows) throw opts.createDatasetItemThrows;
    return { id: "item-1" };
  });
  return {
    langfuse: {
      api: { traceList },
      getDataset,
      createDataset,
      createDatasetItem,
    },
    createDatasetItem,
    createDataset,
  };
}

const baseArgs: EvalExportArgs = {
  from: "2026-05-10",
  to: "2026-05-17",
  sample: 5,
  dataset: "eval-smoke",
  seed: 42,
};

const FIXED_NOW = new Date("2026-05-17T12:00:00.000Z");
const silentLog = (): void => {
  /* suppress */
};

// ---------------------------------------------------------------------------
// (a) 5 fixture traces, fresh project → 5 items created
// ---------------------------------------------------------------------------

describe("runEvalExport — case (a) fresh project", () => {
  it("creates one dataset item per sampled trace", async () => {
    const fetched = Array.from({ length: 5 }, (_, i) =>
      makeTrace(`sub-${i + 1}`),
    );
    const { langfuse, createDatasetItem } = makeLangfuseStub({ fetched });
    const db = makeDbStub(fetched.map((t) => extractTraceMetadata(t).submissionId!));

    const result = await runEvalExport({
      langfuse,
      db,
      args: baseArgs,
      now: () => FIXED_NOW,
      log: silentLog,
    });

    expect(result.fetchedCount).toBe(5);
    expect(result.sampled).toHaveLength(5);
    expect(result.created).toHaveLength(5);
    expect(result.skippedDedupe).toEqual([]);
    expect(result.missingInDb).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(createDatasetItem).toHaveBeenCalledTimes(5);

    // Spot-check the body shape of one item — guards against drift in the
    // input/expectedOutput/metadata schema callers downstream depend on.
    const firstCall = createDatasetItem.mock.calls[0][0] as {
      datasetName: string;
      input: { exercise: unknown; userAnswer: string; language: string; difficulty: string };
      expectedOutput: unknown;
      metadata: Record<string, unknown>;
    };
    expect(firstCall.datasetName).toBe("eval-smoke");
    expect(firstCall.input.userAnswer).toMatch(/^answer-sub-/);
    expect(firstCall.input.language).toBe("ES");
    expect(firstCall.input.difficulty).toBe("B1");
    expect(firstCall.metadata.exportedAt).toBe(FIXED_NOW.toISOString());
    expect(firstCall.metadata.localPromptVersion).toBe(
      "evaluate@2026-05-12",
    );
  });
});

// ---------------------------------------------------------------------------
// (b) 3 of 5 already in the dataset → 2 items created
// ---------------------------------------------------------------------------

describe("runEvalExport — case (b) dedupe", () => {
  it("skips submissionIds already present in the dataset", async () => {
    const fetched = Array.from({ length: 5 }, (_, i) =>
      makeTrace(`sub-${i + 1}`),
    );
    const existingItems = [
      { metadata: { submissionId: "sub-1" } },
      { metadata: { submissionId: "sub-2" } },
      { metadata: { submissionId: "sub-3" } },
    ];
    const { langfuse, createDatasetItem } = makeLangfuseStub({
      fetched,
      existingItems,
    });
    const db = makeDbStub(["sub-4", "sub-5"]);

    const result = await runEvalExport({
      langfuse,
      db,
      args: baseArgs,
      now: () => FIXED_NOW,
      log: silentLog,
    });

    expect(result.skippedDedupe.sort()).toEqual(["sub-1", "sub-2", "sub-3"]);
    expect(result.created.sort()).toEqual(["sub-4", "sub-5"]);
    expect(createDatasetItem).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// (c) one trace missing user answer in Neon → logged + skipped, 4 created
// ---------------------------------------------------------------------------

describe("runEvalExport — case (c) DB row missing", () => {
  it("logs + skips a sampled trace whose submission has no DB row", async () => {
    const fetched = Array.from({ length: 5 }, (_, i) =>
      makeTrace(`sub-${i + 1}`),
    );
    // DB only knows about 4 of the 5 submissions — sub-3 was deleted or
    // the trace metadata points at a row that never existed.
    const db = makeDbStub(["sub-1", "sub-2", "sub-4", "sub-5"]);
    const { langfuse, createDatasetItem } = makeLangfuseStub({ fetched });
    const log = vi.fn();

    const result = await runEvalExport({
      langfuse,
      db,
      args: baseArgs,
      now: () => FIXED_NOW,
      log,
    });

    expect(result.created.sort()).toEqual([
      "sub-1",
      "sub-2",
      "sub-4",
      "sub-5",
    ]);
    expect(result.missingInDb).toEqual(["sub-3"]);
    expect(result.errors).toEqual([]);
    expect(createDatasetItem).toHaveBeenCalledTimes(4);
    // Log surface: operator should see WHICH submissionId was dropped.
    expect(
      log.mock.calls.some(
        (a) => typeof a[0] === "string" && a[0].includes("sub-3"),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (d) Langfuse outage on createDataset → orchestrator throws
// ---------------------------------------------------------------------------

describe("runEvalExport — case (d) createDataset outage", () => {
  it("propagates the createDataset error (so the CLI exits non-zero)", async () => {
    const fetched = Array.from({ length: 5 }, (_, i) =>
      makeTrace(`sub-${i + 1}`),
    );
    const outage = new Error("ECONNRESET");
    const notFound = Object.assign(new Error("not found"), { status: 404 });
    const { langfuse, createDatasetItem } = makeLangfuseStub({
      fetched,
      getDatasetThrows: notFound,
      createDatasetThrows: outage,
    });
    const db = makeDbStub(["sub-1", "sub-2", "sub-3", "sub-4", "sub-5"]);

    await expect(
      runEvalExport({
        langfuse,
        db,
        args: baseArgs,
        now: () => FIXED_NOW,
        log: silentLog,
      }),
    ).rejects.toBe(outage);
    expect(createDatasetItem).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Bonus — per-item createDatasetItem failure is recorded, not fatal
// ---------------------------------------------------------------------------

describe("writeSampledTracesToDataset — per-item failure", () => {
  it("records the error and continues with subsequent traces", async () => {
    const fetched = [makeTrace("sub-1"), makeTrace("sub-2")];
    const failOnce = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ id: "ok" });
    const langfuse: LangfuseDatasetApi = {
      api: { traceList: vi.fn() },
      getDataset: vi.fn(),
      createDataset: vi.fn(),
      createDatasetItem: failOnce,
    };
    const db = makeDbStub(["sub-1", "sub-2"]);

    const result = await writeSampledTracesToDataset({
      langfuse,
      db,
      datasetName: "eval-smoke",
      sampled: fetched,
      existingSubmissionIds: new Set(),
      now: () => FIXED_NOW,
      log: silentLog,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].submissionId).toBe("sub-1");
    expect(result.created).toEqual(["sub-2"]);
  });

  it("skips traces whose metadata lacks submissionId/language/cefrLevel/exerciseType", async () => {
    const orphan: FetchedTrace = {
      id: "trace-orphan",
      metadata: { language: "ES" /* submissionId missing */ },
    };
    const langfuse: LangfuseDatasetApi = {
      api: { traceList: vi.fn() },
      getDataset: vi.fn(),
      createDataset: vi.fn(),
      createDatasetItem: vi.fn(),
    };

    const result = await writeSampledTracesToDataset({
      langfuse,
      db: { lookupExerciseSubmission: vi.fn() },
      datasetName: "eval-smoke",
      sampled: [orphan],
      existingSubmissionIds: new Set(),
      now: () => FIXED_NOW,
      log: silentLog,
    });

    expect(result.missingMetadata).toEqual(["trace-orphan"]);
    expect(result.created).toEqual([]);
    expect(langfuse.createDatasetItem).not.toHaveBeenCalled();
  });
});
