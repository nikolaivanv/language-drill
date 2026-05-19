/**
 * Unit tests for `eval-run.ts` (Phase 2 Task 24).
 *
 * Uses port-style DI (`EvalRunItemExecutor`, `LangfuseDatasetIterator`)
 * so neither the Langfuse SDK nor Anthropic spin up. Covers the four
 * spec-required scenarios:
 *
 *   (a) 3-item dataset, file candidate → 3 evals, 3 `item.link` calls, 3 results
 *   (b) LANGFUSE_ENV=prod without --allow-prod → throws before any call
 *   (c) Per-item evaluator throws on item 2 → 3 results, one with `error`,
 *       no early termination
 *   (d) item.link throws → warning logged; eval data still in summary
 *
 * Plus targeted coverage of the helper functions exported for the CLI:
 * argv parsing, candidate resolution (file: + langfuse:), runName
 * derivation, and the production guard's exact predicate.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CefrLevel, ExerciseType, Language } from "@language-drill/shared";

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertNotProdWithoutAllow,
  cefrIndex,
  cefrStats,
  computeDiff,
  deltaStats,
  deriveRunName,
  parseEvalRunArgs,
  renderMarkdownSummary,
  resolveCandidate,
  runEvalRun,
  writeSummaryJson,
  type EvalRunArgs,
  type EvalRunDatasetItem,
  type EvalRunItemExecutor,
  type EvalRunOrchestrationResult,
  type EvalRunSummary,
  type ItemResult,
  type LangfuseDatasetIterator,
  type LangfusePromptFetcher,
} from "./eval-run";

// ---------------------------------------------------------------------------
// Production guard
// ---------------------------------------------------------------------------

describe("assertNotProdWithoutAllow", () => {
  it("throws when LANGFUSE_ENV is prod and --allow-prod is false", () => {
    expect(() => assertNotProdWithoutAllow("prod", false)).toThrow(
      /requires --allow-prod/,
    );
  });

  it("returns when LANGFUSE_ENV is prod and --allow-prod is true", () => {
    expect(() => assertNotProdWithoutAllow("prod", true)).not.toThrow();
  });

  it("returns when LANGFUSE_ENV is dev or unset", () => {
    expect(() => assertNotProdWithoutAllow("dev", false)).not.toThrow();
    expect(() => assertNotProdWithoutAllow(undefined, false)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// argv parsing
// ---------------------------------------------------------------------------

describe("parseEvalRunArgs", () => {
  it("parses all required + optional fields", () => {
    const args = parseEvalRunArgs([
      "--dataset",
      "eval-smoke",
      "--candidate",
      "file:./candidate.txt",
      "--run-name",
      "demo-run",
      "--allow-prod",
      "--limit",
      "5",
    ]);
    expect(args).toEqual({
      dataset: "eval-smoke",
      candidate: "file:./candidate.txt",
      runName: "demo-run",
      allowProd: true,
      limit: 5,
    });
  });

  it("throws when --dataset is missing", () => {
    expect(() =>
      parseEvalRunArgs(["--candidate", "file:./candidate.txt"]),
    ).toThrow(/--dataset/);
  });

  it("throws when --candidate is missing", () => {
    expect(() => parseEvalRunArgs(["--dataset", "eval-smoke"])).toThrow(
      /--candidate/,
    );
  });

  it("throws when --limit is non-numeric", () => {
    expect(() =>
      parseEvalRunArgs([
        "--dataset",
        "eval-smoke",
        "--candidate",
        "file:./c.txt",
        "--limit",
        "abc",
      ]),
    ).toThrow(/--limit/);
  });

  it("defaults --allow-prod to false", () => {
    const args = parseEvalRunArgs([
      "--dataset",
      "eval-smoke",
      "--candidate",
      "file:./c.txt",
    ]);
    expect(args.allowProd).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveCandidate
// ---------------------------------------------------------------------------

describe("resolveCandidate", () => {
  it("reads a file: candidate via the injected readFile", async () => {
    const readFile = vi.fn().mockReturnValue("FILE CANDIDATE BODY");
    const stub: LangfusePromptFetcher = {
      getPrompt: vi.fn(),
    };
    const resolved = await resolveCandidate(
      "file:./fixtures/candidate.txt",
      stub,
      { readFile },
    );
    expect(resolved).toEqual({
      text: "FILE CANDIDATE BODY",
      source: "file:./fixtures/candidate.txt",
    });
    expect(readFile).toHaveBeenCalledWith("./fixtures/candidate.txt");
  });

  it("fetches a langfuse:<name>@<label> candidate via getPrompt", async () => {
    const getPrompt = vi.fn().mockResolvedValue({ prompt: "LANGFUSE BODY" });
    const stub: LangfusePromptFetcher = { getPrompt };
    const resolved = await resolveCandidate(
      "langfuse:evaluate-system-prompt@candidate-2026-05-20",
      stub,
    );
    expect(resolved.text).toBe("LANGFUSE BODY");
    expect(getPrompt).toHaveBeenCalledWith(
      "evaluate-system-prompt",
      undefined,
      { label: "candidate-2026-05-20" },
    );
  });

  it("defaults the label to `candidate` when omitted", async () => {
    const getPrompt = vi.fn().mockResolvedValue({ prompt: "x" });
    await resolveCandidate(
      "langfuse:evaluate-system-prompt",
      { getPrompt },
    );
    expect(getPrompt).toHaveBeenCalledWith(
      "evaluate-system-prompt",
      undefined,
      { label: "candidate" },
    );
  });

  it("throws on an unsupported candidate prefix", async () => {
    await expect(
      resolveCandidate("http://oops", { getPrompt: vi.fn() }),
    ).rejects.toThrow(/unsupported --candidate/);
  });

  it("throws when langfuse: name part is empty", async () => {
    await expect(
      resolveCandidate("langfuse:@candidate", { getPrompt: vi.fn() }),
    ).rejects.toThrow(/invalid candidate/);
  });
});

// ---------------------------------------------------------------------------
// deriveRunName
// ---------------------------------------------------------------------------

describe("deriveRunName", () => {
  const FIXED = new Date("2026-05-17T12:00:00.000Z");

  it("uses the explicit name when supplied", () => {
    expect(deriveRunName("abc12345", "operator-run", FIXED)).toBe("operator-run");
  });

  it("derives `candidate-<sha>-<iso>` when no name is supplied", () => {
    expect(deriveRunName("abc12345", undefined, FIXED)).toBe(
      "candidate-abc12345-2026-05-17T12:00:00.000Z",
    );
  });

  it("derives the same fallback for empty-string --run-name", () => {
    expect(deriveRunName("abc12345", "", FIXED)).toBe(
      "candidate-abc12345-2026-05-17T12:00:00.000Z",
    );
  });
});

// ---------------------------------------------------------------------------
// runEvalRun — orchestration fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date("2026-05-17T12:00:00.000Z");

function makeArgs(overrides: Partial<EvalRunArgs> = {}): EvalRunArgs {
  return {
    dataset: "eval-smoke",
    candidate: "file:./candidate.txt",
    allowProd: false,
    ...overrides,
  };
}

function makeValidInput(suffix: string): {
  exercise: { type: ExerciseType; instructions: string; sentence: string; correctAnswer: string };
  userAnswer: string;
  language: Language;
  difficulty: CefrLevel;
} {
  return {
    exercise: {
      type: ExerciseType.CLOZE,
      instructions: `instr-${suffix}`,
      sentence: `Fill in ___ here (${suffix}).`,
      correctAnswer: `ans-${suffix}`,
    },
    userAnswer: `answer-${suffix}`,
    language: Language.ES,
    difficulty: CefrLevel.B1,
  };
}

function makeDatasetItem(
  id: string,
  link: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ id: `link-${id}` }),
): EvalRunDatasetItem {
  return {
    id,
    input: makeValidInput(id),
    expectedOutput: { score: 0.5, feedback: `expected-${id}` },
    metadata: { submissionId: `sub-${id}` },
    link,
  };
}

function makeDatasetStub(
  items: EvalRunDatasetItem[],
): { langfuse: LangfuseDatasetIterator; getDataset: ReturnType<typeof vi.fn> } {
  const getDataset = vi.fn().mockResolvedValue({ name: "eval-smoke", items });
  return {
    langfuse: { getDataset, getPrompt: vi.fn() },
    getDataset,
  };
}

const silentLog = (): void => {
  /* suppress */
};

// ---------------------------------------------------------------------------
// (a) 3-item dataset → 3 evals, 3 link calls, 3 results
// ---------------------------------------------------------------------------

describe("runEvalRun — case (a) happy path", () => {
  it("evaluates every item, links each captured trace, collects per-item results", async () => {
    const items = ["i1", "i2", "i3"].map((id) => makeDatasetItem(id));
    const { langfuse } = makeDatasetStub(items);

    // Stub executor: fixed EvaluationResult per item, fresh fake trace.
    const executor = vi.fn<EvalRunItemExecutor>(async (params) => ({
      actual: {
        score: 0.9,
        grammarAccuracy: 0.9,
        vocabularyRange: "B1",
        taskAchievement: 0.9,
        feedback: `eval-${params.itemId}`,
        errors: [],
        estimatedCefrEvidence: "B1",
      },
      latencyMs: 100,
      itemTrace: {
        id: `trace-${params.itemId}`,
      } as unknown as Parameters<EvalRunItemExecutor>[0] extends { itemTrace: infer T } ? T : never,
    }));

    const result = await runEvalRun({
      langfuse,
      executor,
      args: makeArgs(),
      candidateText: "CANDIDATE BODY",
      candidateSource: "file:./candidate.txt",
      promptSha: "abc12345",
      runName: "test-run",
      now: () => FIXED_NOW,
      log: silentLog,
    });

    expect(result.items).toHaveLength(3);
    expect(executor).toHaveBeenCalledTimes(3);
    // The first executor call carries the prompt + sha + per-item identity.
    expect(executor).toHaveBeenNthCalledWith(1, {
      itemId: "i1",
      evaluateInput: items[0].input,
      candidateText: "CANDIDATE BODY",
      promptSha: "abc12345",
    });

    // 3 link calls, each carrying the trace + runName + metadata.
    for (const item of items) {
      expect(item.link).toHaveBeenCalledTimes(1);
      expect(item.link).toHaveBeenCalledWith(
        { id: `trace-${item.id}` },
        "test-run",
        { metadata: { promptSha: "abc12345", candidateSource: "file:./candidate.txt" } },
      );
    }

    // Per-item result shape: submissionId pulled from metadata, traceId
    // pulled from the captured trace, actual surfaced verbatim.
    expect(result.items[0]).toMatchObject({
      itemId: "i1",
      submissionId: "sub-i1",
      candidateTraceId: "trace-i1",
    });
    expect(result.items[0].actual?.feedback).toBe("eval-i1");
    expect(result.runName).toBe("test-run");
    expect(result.promptSha).toBe("abc12345");
    expect(result.datasetName).toBe("eval-smoke");
    expect(result.startedAt).toBe(FIXED_NOW.toISOString());
  });
});

// ---------------------------------------------------------------------------
// (b) LANGFUSE_ENV=prod without --allow-prod → throws BEFORE any executor call
// ---------------------------------------------------------------------------

describe("runEvalRun — case (b) production guard", () => {
  const envSnapshot = new Map<string, string | undefined>();
  beforeEach(() => {
    envSnapshot.set("LANGFUSE_ENV", process.env.LANGFUSE_ENV);
    process.env.LANGFUSE_ENV = "prod";
  });
  afterEach(() => {
    const v = envSnapshot.get("LANGFUSE_ENV");
    if (v === undefined) delete process.env.LANGFUSE_ENV;
    else process.env.LANGFUSE_ENV = v;
  });

  it("rejects with the prod-guard message before any orchestration runs", () => {
    // The CLI surface calls assertNotProdWithoutAllow at the top of main().
    // We replicate that behavior here: the assertion must throw before any
    // Langfuse / Anthropic call happens. Tested in isolation rather than
    // by spawning the CLI because the assertion is the entire test.
    expect(() => assertNotProdWithoutAllow(process.env.LANGFUSE_ENV, false))
      .toThrow(/requires --allow-prod/);

    // Sanity: the same env value passes the guard when --allow-prod is set.
    expect(() => assertNotProdWithoutAllow(process.env.LANGFUSE_ENV, true))
      .not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// (c) Executor throws on item 2 → 3 results, one with error set
// ---------------------------------------------------------------------------

describe("runEvalRun — case (c) per-item executor error", () => {
  it("records the error, keeps going, returns a full-size result list", async () => {
    const items = ["i1", "i2", "i3"].map((id) => makeDatasetItem(id));
    const { langfuse } = makeDatasetStub(items);

    // Executor returns success / error / success — matches Scenario 3
    // in the design ("a dataset item's evaluateAnswer throws"). The
    // executor's contract is to RETURN an `error` field, not re-throw —
    // makeRealItemExecutor catches inside its try/catch.
    const executor = vi.fn<EvalRunItemExecutor>(async (params) => {
      if (params.itemId === "i2") {
        return {
          error: "Claude API timed out",
          latencyMs: 200,
        };
      }
      return {
        actual: {
          score: 0.5,
          grammarAccuracy: 0.5,
          vocabularyRange: "B1",
          taskAchievement: 0.5,
          feedback: `ok-${params.itemId}`,
          errors: [],
          estimatedCefrEvidence: "B1",
        },
        latencyMs: 100,
        itemTrace: { id: `trace-${params.itemId}` } as never,
      };
    });

    const result = await runEvalRun({
      langfuse,
      executor,
      args: makeArgs(),
      candidateText: "CANDIDATE",
      candidateSource: "file:./candidate.txt",
      promptSha: "abc12345",
      runName: "test-run",
      now: () => FIXED_NOW,
      log: silentLog,
    });

    expect(result.items).toHaveLength(3);
    expect(executor).toHaveBeenCalledTimes(3); // never short-circuited

    const errorItem = result.items.find((r) => r.error !== undefined);
    expect(errorItem?.itemId).toBe("i2");
    expect(errorItem?.error).toBe("Claude API timed out");
    expect(errorItem?.actual).toBeUndefined();

    // i2 had no captured trace → its link should NOT have been called.
    expect(items[1].link).not.toHaveBeenCalled();
    // i1 + i3 still linked normally.
    expect(items[0].link).toHaveBeenCalledTimes(1);
    expect(items[2].link).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// (d) item.link throws → warning logged, eval data still in summary
// ---------------------------------------------------------------------------

describe("runEvalRun — case (d) link() failure", () => {
  it("warns + continues; per-item result is preserved", async () => {
    const linkErr = new Error("dataset run not found");
    const items = [
      makeDatasetItem("i1", vi.fn().mockRejectedValue(linkErr)),
      makeDatasetItem("i2"),
    ];
    const { langfuse } = makeDatasetStub(items);

    const executor = vi.fn<EvalRunItemExecutor>(async (params) => ({
      actual: {
        score: 0.9,
        grammarAccuracy: 0.9,
        vocabularyRange: "B1",
        taskAchievement: 0.9,
        feedback: `eval-${params.itemId}`,
        errors: [],
        estimatedCefrEvidence: "B1",
      },
      latencyMs: 100,
      itemTrace: { id: `trace-${params.itemId}` } as never,
    }));

    const log = vi.fn();
    const result = await runEvalRun({
      langfuse,
      executor,
      args: makeArgs(),
      candidateText: "CANDIDATE",
      candidateSource: "file:./candidate.txt",
      promptSha: "abc12345",
      runName: "test-run",
      now: () => FIXED_NOW,
      log,
    });

    // i1's link threw — but eval data is still in the summary.
    expect(result.items).toHaveLength(2);
    expect(result.items[0].itemId).toBe("i1");
    expect(result.items[0].actual?.feedback).toBe("eval-i1");
    // No `error` field set — the link failure is soft.
    expect(result.items[0].error).toBeUndefined();

    // A warning log mentioning the failing item should fire so the
    // operator can investigate the broken link without losing the data.
    const linkWarn = log.mock.calls.find(
      (args) => typeof args[0] === "string" && args[0].includes("item.link failed"),
    );
    expect(linkWarn).toBeDefined();
    expect(String(linkWarn![0])).toContain("i1");

    // i2 still linked normally.
    expect(items[1].link).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Bonus — --limit caps items processed
// ---------------------------------------------------------------------------

describe("runEvalRun — --limit", () => {
  it("processes only the first N items when --limit is set", async () => {
    const items = ["i1", "i2", "i3", "i4", "i5"].map((id) => makeDatasetItem(id));
    const { langfuse } = makeDatasetStub(items);

    const executor = vi.fn<EvalRunItemExecutor>(async () => ({
      actual: {
        score: 0.9,
        grammarAccuracy: 0.9,
        vocabularyRange: "B1",
        taskAchievement: 0.9,
        feedback: "ok",
        errors: [],
        estimatedCefrEvidence: "B1",
      },
      latencyMs: 100,
      itemTrace: { id: "t" } as never,
    }));

    const result = await runEvalRun({
      langfuse,
      executor,
      args: makeArgs({ limit: 2 }),
      candidateText: "CANDIDATE",
      candidateSource: "file:./candidate.txt",
      promptSha: "abc12345",
      runName: "test-run",
      now: () => FIXED_NOW,
      log: silentLog,
    });

    expect(result.items).toHaveLength(2);
    expect(executor).toHaveBeenCalledTimes(2);
    // Items past the limit must NOT have been linked.
    expect(items[2].link).not.toHaveBeenCalled();
    expect(items[3].link).not.toHaveBeenCalled();
    expect(items[4].link).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Bonus — malformed item.input is recorded as an error without crashing
// ---------------------------------------------------------------------------

describe("runEvalRun — malformed item.input", () => {
  it("records an error per item with bad shape and does not call the executor", async () => {
    const goodItem = makeDatasetItem("good");
    const badItem: EvalRunDatasetItem = {
      id: "bad",
      input: { exercise: null /* userAnswer missing */ },
      expectedOutput: {},
      link: vi.fn().mockResolvedValue({ id: "x" }),
    };
    const { langfuse } = makeDatasetStub([goodItem, badItem]);

    const executor = vi.fn<EvalRunItemExecutor>(async () => ({
      actual: {
        score: 0.5,
        grammarAccuracy: 0.5,
        vocabularyRange: "B1",
        taskAchievement: 0.5,
        feedback: "f",
        errors: [],
        estimatedCefrEvidence: "B1",
      },
      latencyMs: 100,
      itemTrace: { id: "t-good" } as never,
    }));

    const result = await runEvalRun({
      langfuse,
      executor,
      args: makeArgs(),
      candidateText: "CANDIDATE",
      candidateSource: "file:./candidate.txt",
      promptSha: "abc12345",
      runName: "test-run",
      now: () => FIXED_NOW,
      log: silentLog,
    });

    expect(executor).toHaveBeenCalledTimes(1); // only the good item
    expect(result.items[1].itemId).toBe("bad");
    expect(result.items[1].error).toMatch(/does not match EvaluateAnswerInput/);
    expect(badItem.link).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Task-25 helpers — cefrIndex, deltaStats, cefrStats
// ---------------------------------------------------------------------------

describe("cefrIndex", () => {
  it("maps A1..C2 to 0..5 (case-insensitive)", () => {
    expect(cefrIndex("A1")).toBe(0);
    expect(cefrIndex("a2")).toBe(1);
    expect(cefrIndex("B1")).toBe(2);
    expect(cefrIndex("c2")).toBe(5);
  });

  it("returns undefined for unknown levels", () => {
    expect(cefrIndex("zzz")).toBeUndefined();
  });
});

function makeItem(overrides: Partial<ItemResult>): ItemResult {
  return {
    itemId: "id",
    input: makeValidInput("x"),
    expected: { score: 0.5, errors: [], estimatedCefrEvidence: "B1" },
    latencyMs: 100,
    ...overrides,
  };
}

describe("deltaStats", () => {
  it("returns 0/0 with no signFlips when no items can be compared", () => {
    expect(deltaStats([], (r) => r.score)).toEqual({
      avgDelta: 0,
      p95AbsDelta: 0,
    });
  });

  it("computes avgDelta + p95|Δ| across items where both sides have the field", () => {
    const items: ItemResult[] = [
      makeItem({
        expected: { score: 0.5 },
        actual: {
          score: 0.6,
          grammarAccuracy: 0,
          vocabularyRange: "",
          taskAchievement: 0,
          feedback: "",
          errors: [],
          estimatedCefrEvidence: "",
        },
        latencyMs: 1,
      }),
      makeItem({
        expected: { score: 0.4 },
        actual: {
          score: 0.7,
          grammarAccuracy: 0,
          vocabularyRange: "",
          taskAchievement: 0,
          feedback: "",
          errors: [],
          estimatedCefrEvidence: "",
        },
        latencyMs: 2,
      }),
      // No `actual` → skipped.
      makeItem({ expected: { score: 0.9 }, latencyMs: 3 }),
    ];
    const stats = deltaStats(items, (r) => r.score);
    expect(stats.avgDelta).toBeCloseTo(0.2, 5);
    expect(stats.p95AbsDelta).toBeCloseTo(0.3, 5);
  });

  it("includes signFlips around the supplied threshold", () => {
    const items: ItemResult[] = [
      makeItem({
        expected: { score: 0.4 },
        actual: {
          score: 0.6, // 0.4 → 0.6 crosses 0.5 → flip
          grammarAccuracy: 0,
          vocabularyRange: "",
          taskAchievement: 0,
          feedback: "",
          errors: [],
          estimatedCefrEvidence: "",
        },
      }),
      makeItem({
        expected: { score: 0.55 },
        actual: {
          score: 0.58, // both above 0.5 → no flip
          grammarAccuracy: 0,
          vocabularyRange: "",
          taskAchievement: 0,
          feedback: "",
          errors: [],
          estimatedCefrEvidence: "",
        },
      }),
    ];
    const stats = deltaStats(items, (r) => r.score, 0.5);
    expect(stats.signFlips).toBe(1);
  });
});

describe("cefrStats", () => {
  it("reports agreementRate + avgDistance over comparable items", () => {
    const items: ItemResult[] = [
      makeItem({
        expected: { estimatedCefrEvidence: "B1" },
        actual: {
          score: 0,
          grammarAccuracy: 0,
          vocabularyRange: "",
          taskAchievement: 0,
          feedback: "",
          errors: [],
          estimatedCefrEvidence: "B1",
        }, // exact match
      }),
      makeItem({
        expected: { estimatedCefrEvidence: "B1" },
        actual: {
          score: 0,
          grammarAccuracy: 0,
          vocabularyRange: "",
          taskAchievement: 0,
          feedback: "",
          errors: [],
          estimatedCefrEvidence: "B2",
        }, // 1-step
      }),
      makeItem({
        expected: { estimatedCefrEvidence: "A1" },
        actual: {
          score: 0,
          grammarAccuracy: 0,
          vocabularyRange: "",
          taskAchievement: 0,
          feedback: "",
          errors: [],
          estimatedCefrEvidence: "C2",
        }, // 5-step
      }),
    ];
    const stats = cefrStats(items);
    // 1 out of 3 matched.
    expect(stats.agreementRate).toBeCloseTo(1 / 3, 5);
    // Average distance: (0 + 1 + 5) / 3 = 2
    expect(stats.avgDistance).toBeCloseTo(2, 5);
  });
});

// ---------------------------------------------------------------------------
// Task-25 fixtures for computeDiff / render / write
// ---------------------------------------------------------------------------

function makeFixtureOkResult(id: string, overrides: Partial<ItemResult> = {}): ItemResult {
  // Expected scores sit just below the 0.5 pass/fail threshold; actuals
  // sit just above — so every fixture item crosses the threshold and
  // contributes a sign-flip to the delta stats.
  return {
    itemId: id,
    submissionId: `sub-${id}`,
    input: makeValidInput(id),
    expected: {
      score: 0.4,
      grammarAccuracy: 0.4,
      vocabularyRange: "B1",
      taskAchievement: 0.4,
      feedback: "expected",
      errors: [],
      estimatedCefrEvidence: "B1",
    },
    actual: {
      score: 0.6,
      grammarAccuracy: 0.6,
      vocabularyRange: "B1",
      taskAchievement: 0.6,
      feedback: "actual",
      errors: [],
      estimatedCefrEvidence: "B1",
    },
    latencyMs: 100,
    candidateTraceId: `trace-${id}`,
    candidateCostUsd: 0.005,
    baselineCostUsd: null,
    ...overrides,
  };
}

function makeFixtureOrchestrationResult(
  items: ItemResult[],
  overrides: Partial<EvalRunOrchestrationResult> = {},
): EvalRunOrchestrationResult {
  return {
    runName: "test-run",
    promptSha: "abc12345",
    candidateSource: "file:./candidate.txt",
    datasetName: "eval-smoke",
    startedAt: FIXED_NOW.toISOString(),
    items,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeDiff
// ---------------------------------------------------------------------------

describe("computeDiff", () => {
  it("rolls 3-item per-item results into a complete summary", () => {
    const items = ["i1", "i2", "i3"].map((id) => makeFixtureOkResult(id));
    const summary = computeDiff(makeFixtureOrchestrationResult(items));

    expect(summary.itemCount).toBe(3);
    expect(summary.okCount).toBe(3);
    expect(summary.errorCount).toBe(0);
    expect(summary.errors).toEqual([]);

    // score: each item is +0.2 → avgDelta 0.2, all under 0.5 threshold then
    // jumping over → 3 signFlips.
    expect(summary.score.avgDelta).toBeCloseTo(0.2, 5);
    expect(summary.score.signFlips).toBe(3);

    // CEFR: identical → 100% agreement, 0 distance.
    expect(summary.cefr.agreementRate).toBe(1);
    expect(summary.cefr.avgDistance).toBe(0);

    // Cost: candidate sums 0.005 × 3 = 0.015; baseline always null today.
    expect(summary.costUsd.candidate).toBeCloseTo(0.015, 4);
    expect(summary.costUsd.baseline).toBeNull();
    expect(summary.costUsd.deltaPct).toBeNull();

    // Latency: all 100ms → p50 = p95 = 100.
    expect(summary.latencyMs.candidate.p50).toBe(100);
    expect(summary.latencyMs.candidate.p95).toBe(100);

    // `perItem` is reserved for the JSON file; it MUST be present in the
    // returned summary (the stdout renderer is what filters it out).
    expect(summary.perItem).toHaveLength(3);
  });

  it("records errors and reports errorCount when items fail", () => {
    const items: ItemResult[] = [
      makeFixtureOkResult("i1"),
      makeItem({
        itemId: "i2",
        submissionId: "sub-i2",
        error: "Claude API timeout",
        latencyMs: 250,
        baselineCostUsd: null,
      }),
      makeFixtureOkResult("i3"),
    ];
    const summary = computeDiff(makeFixtureOrchestrationResult(items));

    expect(summary.itemCount).toBe(3);
    expect(summary.okCount).toBe(2);
    expect(summary.errorCount).toBe(1);
    expect(summary.errors).toEqual([
      { submissionId: "sub-i2", itemId: "i2", error: "Claude API timeout" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// renderMarkdownSummary — case (a)
// ---------------------------------------------------------------------------

describe("renderMarkdownSummary — case (a) all columns present", () => {
  it("includes every documented column header + key metric row", () => {
    const items = ["i1", "i2", "i3"].map((id) => makeFixtureOkResult(id));
    const summary = computeDiff(makeFixtureOrchestrationResult(items));

    const md = renderMarkdownSummary(summary);

    // Heading + metadata block.
    expect(md).toContain("# Eval run `test-run`");
    expect(md).toContain("**candidate:** file:./candidate.txt");
    expect(md).toContain("**promptSha:** abc12345");
    expect(md).toContain("**dataset:** eval-smoke");
    expect(md).toContain("**items:** 3 (ok=3, errors=0)");

    // Table header.
    expect(md).toContain("| Metric | Candidate | Baseline | Delta |");
    expect(md).toContain("|---|---|---|---|");

    // Every metric row.
    expect(md).toContain("| score |");
    expect(md).toContain("| grammarAccuracy |");
    expect(md).toContain("| taskAchievement |");
    expect(md).toContain("| errorCount |");
    expect(md).toContain("| CEFR |");
    expect(md).toContain("| cost USD |");
    expect(md).toContain("| latency p50 (ms) |");
    expect(md).toContain("| latency p95 (ms) |");

    // Baseline columns marked "(not captured)" today.
    expect(md).toContain("(not captured)");
  });

  it("renders an `## Errors` section when items have errors", () => {
    const items: ItemResult[] = [
      makeFixtureOkResult("i1"),
      makeItem({
        itemId: "i2",
        submissionId: "sub-i2",
        error: "boom",
        baselineCostUsd: null,
      }),
    ];
    const md = renderMarkdownSummary(
      computeDiff(makeFixtureOrchestrationResult(items)),
    );
    expect(md).toContain("## Errors");
    expect(md).toContain("`sub-i2`: boom");
  });
});

// ---------------------------------------------------------------------------
// writeSummaryJson — case (b)
// ---------------------------------------------------------------------------

describe("writeSummaryJson — case (b) JSON file with perItem", () => {
  it("writes the JSON file under <outDir>/<runName>.json with perItem present", () => {
    const items = ["i1", "i2", "i3"].map((id) => makeFixtureOkResult(id));
    const summary = computeDiff(makeFixtureOrchestrationResult(items));

    const tmp = mkdtempSync(path.join(tmpdir(), "eval-runs-test-"));
    try {
      const filePath = writeSummaryJson(summary, tmp);
      expect(filePath).toBe(path.resolve(path.join(tmp, "test-run.json")));

      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as EvalRunSummary;
      expect(parsed.runName).toBe("test-run");
      expect(parsed.itemCount).toBe(3);
      // The whole point of writing JSON (vs. the stdout summary): keep perItem.
      expect(parsed.perItem).toHaveLength(3);
      expect(parsed.perItem?.[0].itemId).toBe("i1");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("creates the output directory if it does not exist", () => {
    const summary = computeDiff(
      makeFixtureOrchestrationResult([makeFixtureOkResult("only")]),
    );
    const tmp = mkdtempSync(path.join(tmpdir(), "eval-runs-test-"));
    try {
      const nested = path.join(tmp, "nested", "deeper");
      const filePath = writeSummaryJson(summary, nested);
      // File got written → mkdirSync(recursive: true) did its job.
      expect(filePath).toContain(path.join("nested", "deeper", "test-run.json"));
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as EvalRunSummary;
      expect(parsed.runName).toBe("test-run");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Exit-code predicate — case (c)
// ---------------------------------------------------------------------------

describe("computeDiff exit-code gate — case (c)", () => {
  it("populates summary.errors when items fail (CLI exits 1 on .length > 0)", () => {
    const items: ItemResult[] = [
      makeFixtureOkResult("i1"),
      makeItem({
        itemId: "i2",
        submissionId: "sub-i2",
        error: "boom",
        baselineCostUsd: null,
      }),
    ];
    const summary = computeDiff(makeFixtureOrchestrationResult(items));
    expect(summary.errors.length).toBeGreaterThan(0);
    // Mirror the CLI's exact gate to lock the contract:
    expect(summary.errors.length > 0).toBe(true);
  });

  it("returns an empty errors array when every item succeeded (CLI exits 0)", () => {
    const items = ["i1", "i2", "i3"].map((id) => makeFixtureOkResult(id));
    const summary = computeDiff(makeFixtureOrchestrationResult(items));
    expect(summary.errors).toEqual([]);
    expect(summary.errors.length > 0).toBe(false);
  });
});
