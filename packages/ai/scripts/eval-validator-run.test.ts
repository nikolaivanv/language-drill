/**
 * Unit tests for `eval-validator-run.ts` — the validator replay harness that
 * measures whether the candidateFillers scratchpad + model move (Tasks 1-6)
 * actually improved ambiguity detection, using the labelled fixture (Task 7).
 *
 * `computeArmMetrics` is the load-bearing pure function (Requirement: no
 * network calls, no Anthropic client) — its tests need no mocking at all.
 * The orchestration tests below inject a stub executor (mirrors
 * `eval-gen-run.test.ts`'s `GenCellArmExecutor` DI) so they never touch the
 * real Anthropic SDK either.
 */

import { describe, expect, it, vi } from "vitest";

import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CefrLevel, ExerciseType, Language } from "@language-drill/shared";

import { SELF_INCONSISTENT_REASON } from "../src/validate.js";

import {
  ARMS,
  PRIOR_TEMPLATE,
  computeArmMetrics,
  computeValidatorSummary,
  loadValidatorCases,
  parseEvalValidatorArgs,
  renderValidatorMarkdownSummary,
  runValidatorEval,
  writeValidatorSummaryJson,
  type ValidatorAmbiguityCase,
  type ValidatorCaseExecutor,
  type ValidatorEvalRunResult,
} from "./eval-validator-run.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(
  __dirname,
  "fixtures",
  "validator-ambiguity-cases.json",
);

// ---------------------------------------------------------------------------
// computeArmMetrics — pure, no mocking (brief Step 1)
// ---------------------------------------------------------------------------

describe("computeArmMetrics", () => {
  it("computes recall over the ambiguous bucket only", () => {
    const m = computeArmMetrics(
      [{ label: "ambiguous" }, { label: "ambiguous" }, { label: "clean" }],
      [{ ambiguous: true }, { ambiguous: false }, { ambiguous: false }],
    );
    expect(m.recallOnAmbiguous).toBeCloseTo(0.5);
  });

  it("computes false-flag rate over the clean bucket only", () => {
    const m = computeArmMetrics(
      [{ label: "clean" }, { label: "clean" }],
      [{ ambiguous: true }, { ambiguous: false }],
    );
    expect(m.falseFlagRateOnClean).toBeCloseTo(0.5);
  });

  it("returns 0 for an empty bucket rather than NaN", () => {
    const m = computeArmMetrics([{ label: "clean" }], [{ ambiguous: false }]);
    expect(m.recallOnAmbiguous).toBe(0);
  });

  it("returns 0 (not NaN) for a wholly empty run", () => {
    const m = computeArmMetrics([], []);
    expect(m).toEqual({
      recallOnAmbiguous: 0,
      falseFlagRateOnClean: 0,
      selfInconsistentRate: 0,
      n: 0,
    });
  });

  it("computes selfInconsistentRate over ALL results, not just one bucket", () => {
    const m = computeArmMetrics(
      [{ label: "ambiguous" }, { label: "clean" }, { label: "clean" }],
      [
        { ambiguous: true },
        { ambiguous: false, flaggedReasons: [SELF_INCONSISTENT_REASON] },
        { ambiguous: false, flaggedReasons: ["some-other-reason"] },
      ],
    );
    expect(m.selfInconsistentRate).toBeCloseTo(1 / 3);
  });

  it("treats a missing flaggedReasons as not self-inconsistent", () => {
    const m = computeArmMetrics(
      [{ label: "clean" }],
      [{ ambiguous: false }],
    );
    expect(m.selfInconsistentRate).toBe(0);
  });

  it("reports n as the number of paired results", () => {
    const m = computeArmMetrics(
      [{ label: "ambiguous" }, { label: "clean" }],
      [{ ambiguous: true }, { ambiguous: false }],
    );
    expect(m.n).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// loadValidatorCases — the real fixture must parse cleanly
// ---------------------------------------------------------------------------

describe("loadValidatorCases", () => {
  it("parses the real fixture into 31 cloze-only cases", () => {
    const cases = loadValidatorCases(readFileSync(FIXTURE_PATH, "utf8"));
    expect(cases).toHaveLength(31);
    expect(cases.every((c) => c.content.type === "cloze")).toBe(true);
    expect(cases.filter((c) => c.label === "ambiguous")).toHaveLength(20);
    expect(cases.filter((c) => c.label === "clean")).toHaveLength(11);
  });

  it("normalizes the fixture's lowercase language to the uppercase enum", () => {
    const cases = loadValidatorCases(readFileSync(FIXTURE_PATH, "utf8"));
    expect(cases.every((c) => c.language === c.language.toUpperCase())).toBe(
      true,
    );
    expect(cases.some((c) => c.language === Language.ES)).toBe(true);
  });

  it("throws (file-level) on non-JSON input", () => {
    expect(() => loadValidatorCases("not json")).toThrow(/not valid JSON/);
  });

  it("throws when the top-level value is not an array", () => {
    expect(() => loadValidatorCases("{}")).toThrow(/must be a JSON array/);
  });

  it("throws on a non-cloze content type (cloze-only harness)", () => {
    const raw = JSON.stringify([
      {
        id: "x",
        label: "clean",
        language: "es",
        cefrLevel: "B1",
        grammarPointKey: "es-b1-nominalizers",
        content: { type: "translation" },
      },
    ]);
    expect(() => loadValidatorCases(raw)).toThrow(/must be "cloze"/);
  });

  it("throws on an invalid label", () => {
    const raw = JSON.stringify([
      {
        id: "x",
        label: "maybe",
        language: "es",
        cefrLevel: "B1",
        grammarPointKey: "es-b1-nominalizers",
        content: { type: "cloze" },
      },
    ]);
    expect(() => loadValidatorCases(raw)).toThrow(/label must be/);
  });
});

// ---------------------------------------------------------------------------
// ARMS — the four-arm matrix must never confound prompt and model
// ---------------------------------------------------------------------------

describe("ARMS", () => {
  it("declares exactly the four documented arms", () => {
    expect(ARMS.map((a) => a.name)).toEqual([
      "baseline",
      "prompt-only",
      "model-only",
      "both",
    ]);
  });

  it("pins both baseline arms to claude-sonnet-4-6 explicitly", () => {
    const baseline = ARMS.find((a) => a.name === "baseline")!;
    const promptOnly = ARMS.find((a) => a.name === "prompt-only")!;
    expect(baseline.modelOverride).toBe("claude-sonnet-4-6");
    expect(promptOnly.modelOverride).toBe("claude-sonnet-4-6");
  });

  it("leaves model-only and both on the production default model", () => {
    const modelOnly = ARMS.find((a) => a.name === "model-only")!;
    const both = ARMS.find((a) => a.name === "both")!;
    expect(modelOnly.modelOverride).toBeUndefined();
    expect(both.modelOverride).toBeUndefined();
  });

  it("pins baseline and model-only to the captured pre-Task-4 prompt", () => {
    const baseline = ARMS.find((a) => a.name === "baseline")!;
    const modelOnly = ARMS.find((a) => a.name === "model-only")!;
    expect(baseline.systemPromptOverride).toBe(PRIOR_TEMPLATE);
    expect(modelOnly.systemPromptOverride).toBe(PRIOR_TEMPLATE);
  });

  it("leaves prompt-only and both on the production default prompt", () => {
    const promptOnly = ARMS.find((a) => a.name === "prompt-only")!;
    const both = ARMS.find((a) => a.name === "both")!;
    expect(promptOnly.systemPromptOverride).toBeUndefined();
    expect(both.systemPromptOverride).toBeUndefined();
  });

  it("PRIOR_TEMPLATE is read from the committed fixture, not git", () => {
    const expected = readFileSync(
      path.join(__dirname, "fixtures", "validation-system-prompt-baseline.txt"),
      "utf8",
    );
    expect(PRIOR_TEMPLATE).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// parseEvalValidatorArgs
// ---------------------------------------------------------------------------

describe("parseEvalValidatorArgs", () => {
  it("defaults to no limit, a sane max-cost-usd, and dryRun=false", () => {
    const args = parseEvalValidatorArgs([]);
    expect(args.limit).toBeUndefined();
    expect(args.dryRun).toBe(false);
    expect(args.maxCostUsd).toBeGreaterThan(0);
    expect(args.runName).toBeUndefined();
  });

  it("parses --limit, --max-cost-usd, --dry-run, --run-name", () => {
    const args = parseEvalValidatorArgs([
      "--limit",
      "5",
      "--max-cost-usd",
      "1.5",
      "--dry-run",
      "--run-name",
      "smoke",
    ]);
    expect(args.limit).toBe(5);
    expect(args.maxCostUsd).toBe(1.5);
    expect(args.dryRun).toBe(true);
    expect(args.runName).toBe("smoke");
  });

  it("rejects a non-positive --limit", () => {
    expect(() => parseEvalValidatorArgs(["--limit", "0"])).toThrow(
      /--limit must be a positive integer/,
    );
  });

  it("rejects a non-positive --max-cost-usd", () => {
    expect(() => parseEvalValidatorArgs(["--max-cost-usd", "0"])).toThrow(
      /--max-cost-usd must be a positive number/,
    );
  });
});

// ---------------------------------------------------------------------------
// runValidatorEval — orchestration, DI'd executor (no live Claude)
// ---------------------------------------------------------------------------

function makeCase(
  id: string,
  label: "ambiguous" | "clean",
  grammarPointKey = "es-b1-nominalizers",
): ValidatorAmbiguityCase {
  return {
    id,
    label,
    provenance: "test fixture",
    language: Language.ES,
    cefrLevel: CefrLevel.B1,
    grammarPointKey,
    content: {
      type: ExerciseType.CLOZE,
      instructions: "Completa la frase.",
      sentence: "___ es la respuesta.",
      correctAnswer: "esta",
      acceptableAnswers: [],
    },
    why: "test",
  };
}

const cleanResult = () => ({
  qualityScore: 0.9,
  ambiguous: false,
  contextSpoilsAnswer: false,
  levelMatch: true,
  grammarPointMatch: true,
  culturalIssues: [],
  flaggedReasons: [],
  coverage: {},
  candidateFillers: [],
});

describe("runValidatorEval", () => {
  const arms = ARMS;

  it("runs every case against every arm and pairs results for metrics", async () => {
    const cases = [makeCase("c1", "ambiguous"), makeCase("c2", "clean")];
    const executor: ValidatorCaseExecutor = vi.fn(async () => ({
      result: cleanResult(),
      usage: {
        inputTokens: 100,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 50,
      },
    }));

    const result = await runValidatorEval({
      executor,
      cases,
      arms,
      runName: "test-run",
      datasetName: "test.json",
    });

    // 2 cases x 4 arms
    expect(executor).toHaveBeenCalledTimes(8);
    expect(result.arms).toHaveLength(4);
    for (const arm of result.arms) {
      expect(arm.records).toHaveLength(2);
      expect(arm.records.every((r) => r.result !== undefined)).toBe(true);
    }
    expect(result.costCapped).toBe(false);
  });

  it("isolates a per-(case,arm) executor throw; other pairs still complete", async () => {
    const cases = [makeCase("c1", "ambiguous"), makeCase("c2", "clean")];
    const executor: ValidatorCaseExecutor = vi.fn(async ({ case: c, arm }) => {
      if (c.id === "c1" && arm.name === "baseline") {
        throw new Error("boom");
      }
      return {
        result: cleanResult(),
        usage: {
          inputTokens: 10,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          outputTokens: 5,
        },
      };
    });

    const result = await runValidatorEval({
      executor,
      cases,
      arms,
      runName: "test-run",
      datasetName: "test.json",
    });

    const baseline = result.arms.find((a) => a.arm.name === "baseline")!;
    const c1Record = baseline.records.find((r) => r.caseId === "c1")!;
    expect(c1Record.error).toMatch(/boom/);
    expect(c1Record.result).toBeUndefined();
    // The other arm x case pairs are unaffected.
    expect(
      result.arms
        .flatMap((a) => a.records)
        .filter((r) => r.error !== undefined),
    ).toHaveLength(1);
  });

  it("stops at a case boundary once --max-cost-usd is reached", async () => {
    // Each (case, arm) call bills 100k output tokens = $1.50.
    const cases = [
      makeCase("c1", "ambiguous"),
      makeCase("c2", "clean"),
      makeCase("c3", "clean"),
    ];
    const executor: ValidatorCaseExecutor = vi.fn(async () => ({
      result: cleanResult(),
      usage: {
        inputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 100_000,
      },
    }));

    const result = await runValidatorEval({
      executor,
      cases,
      arms, // 4 arms
      runName: "test-run",
      datasetName: "test.json",
      maxCostUsd: 5, // trips after 1 full case (4 x $1.50 = $6 >= $5)
    });

    expect(result.costCapped).toBe(true);
    // Exactly one case fully attempted across all 4 arms before stopping.
    expect(executor).toHaveBeenCalledTimes(4);
    for (const arm of result.arms) {
      expect(arm.records).toHaveLength(1);
    }
  });

  it("writes partial results rather than discarding the run when cost-capped", async () => {
    const cases = [makeCase("c1", "ambiguous"), makeCase("c2", "clean")];
    const executor: ValidatorCaseExecutor = vi.fn(async () => ({
      result: cleanResult(),
      usage: {
        inputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 100_000,
      },
    }));

    const result: ValidatorEvalRunResult = await runValidatorEval({
      executor,
      cases,
      arms,
      runName: "test-run",
      datasetName: "test.json",
      maxCostUsd: 3, // trips after case 1 (4 arms x $1.50 = $6 >= $3), before case 2
    });

    expect(result.costCapped).toBe(true);
    // Case 1's results are preserved, not discarded, even though the run capped.
    expect(executor).toHaveBeenCalledTimes(4);
    expect(result.arms).toHaveLength(4);
    expect(result.arms.every((a) => a.records.length === 1)).toBe(true);
    expect(result.arms.every((a) => a.records[0].caseId === "c1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeValidatorSummary + rendering (pure roll-up)
// ---------------------------------------------------------------------------

describe("computeValidatorSummary", () => {
  it("rolls per-arm records into metrics + cost, keyed by arm name", () => {
    const cases = [makeCase("c1", "ambiguous"), makeCase("c2", "clean")];
    const run: ValidatorEvalRunResult = {
      runName: "r1",
      datasetName: "test.json",
      startedAt: "2026-01-01T00:00:00.000Z",
      caseCount: 2,
      costCapped: false,
      arms: [
        {
          arm: ARMS[0],
          usage: {
            inputTokens: 100,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            outputTokens: 50,
          },
          records: [
            { caseId: "c1", label: "ambiguous", result: { ...cleanResult(), ambiguous: true } },
            { caseId: "c2", label: "clean", result: cleanResult() },
          ],
        },
      ],
    };

    const summary = computeValidatorSummary(run, cases);
    expect(summary.arms).toHaveLength(1);
    expect(summary.arms[0].arm).toBe("baseline");
    expect(summary.arms[0].metrics.recallOnAmbiguous).toBe(1);
    expect(summary.arms[0].metrics.falseFlagRateOnClean).toBe(0);
    expect(summary.arms[0].costUsd).toBeGreaterThan(0);
    expect(summary.arms[0].errors).toHaveLength(0);
  });

  it("surfaces per-case errors on the owning arm", () => {
    const cases = [makeCase("c1", "ambiguous")];
    const run: ValidatorEvalRunResult = {
      runName: "r1",
      datasetName: "test.json",
      startedAt: "2026-01-01T00:00:00.000Z",
      caseCount: 1,
      costCapped: false,
      arms: [
        {
          arm: ARMS[0],
          usage: {
            inputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            outputTokens: 0,
          },
          records: [{ caseId: "c1", label: "ambiguous", error: "boom" }],
        },
      ],
    };

    const summary = computeValidatorSummary(run, cases);
    expect(summary.arms[0].errors).toEqual([{ caseId: "c1", error: "boom" }]);
    expect(summary.arms[0].metrics.n).toBe(0);
  });
});

describe("renderValidatorMarkdownSummary", () => {
  it("renders a table row per arm with no throw", () => {
    const cases = [makeCase("c1", "ambiguous")];
    const run: ValidatorEvalRunResult = {
      runName: "r1",
      datasetName: "test.json",
      startedAt: "2026-01-01T00:00:00.000Z",
      caseCount: 1,
      costCapped: false,
      arms: [
        {
          arm: ARMS[0],
          usage: {
            inputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            outputTokens: 0,
          },
          records: [{ caseId: "c1", label: "ambiguous", result: cleanResult() }],
        },
      ],
    };
    const summary = computeValidatorSummary(run, cases);
    const md = renderValidatorMarkdownSummary(summary);
    expect(md).toContain("baseline");
    expect(md).toContain("r1");
  });
});

describe("writeValidatorSummaryJson", () => {
  it("names the file validator-<runName>.json", () => {
    const cases = [makeCase("c1", "ambiguous")];
    const run: ValidatorEvalRunResult = {
      runName: "smoke-test-xyz",
      datasetName: "test.json",
      startedAt: "2026-01-01T00:00:00.000Z",
      caseCount: 1,
      costCapped: false,
      arms: [
        {
          arm: ARMS[0],
          usage: {
            inputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            outputTokens: 0,
          },
          records: [],
        },
      ],
    };
    const summary = computeValidatorSummary(run, cases);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "eval-validator-test-"));
    const written = writeValidatorSummaryJson(summary, outDir);
    expect(written).toMatch(/validator-smoke-test-xyz\.json$/);
    const contents = JSON.parse(readFileSync(written, "utf8"));
    expect(contents.runName).toBe("smoke-test-xyz");
  });
});
