/**
 * Unit tests for `eval-gen-run.ts` — the generation-quality eval harness.
 *
 * Mirrors `eval-run.test.ts`: port-style DI (`LangfusePromptFetcher`, an
 * injected `readFile`) so neither the Langfuse SDK nor Anthropic spin up.
 *
 * This file (Task 14) covers prompt-source resolution + render:
 *   - `repo` / `file:` / `langfuse:<name>@<label>` resolution
 *   - the default `candidate` label
 *   - unsupported-prefix and empty-name throws
 *   - `renderSystemPrompt` succeeds on the real template and throws on a
 *     missing `{{var}}`
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";

import { CefrLevel, ExerciseType, Language } from "@language-drill/shared";
import { getGrammarPoint } from "@language-drill/db";

import {
  GENERATION_SYSTEM_PROMPT_TEMPLATE,
  ZERO_USAGE,
  addUsage,
  estimateCostUsd,
  generateBatch,
  validateDraft,
  type ClaudeUsageBreakdown,
  type ExerciseDraft,
  type GenerateBatchResult,
  type GenerationPromptInputs,
  type ValidateDraftResult,
  type ValidationResult,
} from "../src/index.js";
import { sha8 } from "../src/prompts-registry.js";
import {
  computeGenDiff,
  isCellResolutionError,
  loadCellDataset,
  makeRealArmExecutor,
  parseEvalGenArgs,
  renderMarkdownSummary,
  renderSystemPrompt,
  resolveCell,
  resolveGenerationPromptSource,
  runGenEval,
  type ArmResult,
  type CellDescriptor,
  type DraftOutcome,
  type EvalGenArgs,
  type GenCellArmExecutor,
  type GenCellArmExecutorParams,
  type GenEvalRunResult,
  type LangfusePromptFetcher,
  type ResolvedGenerationPromptSource,
} from "./eval-gen-run";

// `generateBatch` / `validateDraft` are mocked so the classification test runs
// without live Claude; `...actual` keeps every other export (addUsage,
// estimateCostUsd, GENERATION_SYSTEM_PROMPT_TEMPLATE, applyTemplate, …) real,
// and `routeValidationResult` (from @language-drill/db) is untouched, so drafts
// route through the genuine routing logic.
vi.mock("../src/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/index.js")>("../src/index.js");
  return { ...actual, generateBatch: vi.fn(), validateDraft: vi.fn() };
});

// ---------------------------------------------------------------------------
// resolveGenerationPromptSource
// ---------------------------------------------------------------------------

describe("resolveGenerationPromptSource", () => {
  it("resolves `repo` to the in-repo template with its sha8", async () => {
    const resolved = await resolveGenerationPromptSource("repo", {
      getPrompt: vi.fn(),
    });
    expect(resolved).toEqual({
      templateBody: GENERATION_SYSTEM_PROMPT_TEMPLATE,
      source: "repo",
      sha: sha8(GENERATION_SYSTEM_PROMPT_TEMPLATE),
    });
  });

  it("reads a file: source via the injected readFile", async () => {
    const readFile = vi.fn().mockReturnValue("FILE TEMPLATE BODY");
    const stub: LangfusePromptFetcher = { getPrompt: vi.fn() };
    const resolved = await resolveGenerationPromptSource(
      "file:./fixtures/candidate.txt",
      stub,
      { readFile },
    );
    expect(resolved).toEqual({
      templateBody: "FILE TEMPLATE BODY",
      source: "file:./fixtures/candidate.txt",
      sha: sha8("FILE TEMPLATE BODY"),
    });
    expect(readFile).toHaveBeenCalledWith("./fixtures/candidate.txt");
  });

  it("fetches a langfuse:<name>@<label> source via getPrompt", async () => {
    const getPrompt = vi.fn().mockResolvedValue({ prompt: "LANGFUSE BODY" });
    const stub: LangfusePromptFetcher = { getPrompt };
    const resolved = await resolveGenerationPromptSource(
      "langfuse:generation-system-prompt@candidate-2026-06-02",
      stub,
    );
    expect(resolved.templateBody).toBe("LANGFUSE BODY");
    expect(resolved.source).toBe(
      "langfuse:generation-system-prompt@candidate-2026-06-02",
    );
    expect(resolved.sha).toBe(sha8("LANGFUSE BODY"));
    expect(getPrompt).toHaveBeenCalledWith(
      "generation-system-prompt",
      undefined,
      { label: "candidate-2026-06-02" },
    );
  });

  it("defaults the langfuse label to `candidate` when omitted", async () => {
    const getPrompt = vi.fn().mockResolvedValue({ prompt: "x" });
    await resolveGenerationPromptSource(
      "langfuse:generation-system-prompt",
      { getPrompt },
    );
    expect(getPrompt).toHaveBeenCalledWith(
      "generation-system-prompt",
      undefined,
      { label: "candidate" },
    );
  });

  it("throws on an unsupported source prefix", async () => {
    await expect(
      resolveGenerationPromptSource("http://oops", { getPrompt: vi.fn() }),
    ).rejects.toThrow(/unsupported prompt source/);
  });

  it("throws when the langfuse: name part is empty", async () => {
    await expect(
      resolveGenerationPromptSource("langfuse:@candidate", {
        getPrompt: vi.fn(),
      }),
    ).rejects.toThrow(/empty name/);
  });
});

// ---------------------------------------------------------------------------
// renderSystemPrompt
// ---------------------------------------------------------------------------

const sampleInputs = (): GenerationPromptInputs => {
  const grammarPoint = getGrammarPoint("tr-a1-locative");
  if (!grammarPoint) throw new Error("test fixture key missing from curriculum");
  return {
    language: Language.TR,
    cefrLevel: CefrLevel.A1,
    exerciseType: ExerciseType.CLOZE,
    grammarPoint,
  };
};

describe("renderSystemPrompt", () => {
  it("renders the real GENERATION_SYSTEM_PROMPT_TEMPLATE with no unresolved vars", () => {
    const text = renderSystemPrompt(
      GENERATION_SYSTEM_PROMPT_TEMPLATE,
      sampleInputs(),
    );
    expect(text.length).toBeGreaterThan(0);
    // A fully-rendered prompt has no leftover `{{placeholder}}` tokens.
    expect(text).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/);
  });

  it("throws when the template references a variable not in the computed map", () => {
    expect(() =>
      renderSystemPrompt(
        "Generate for {{definitely_not_a_real_var}}.",
        sampleInputs(),
      ),
    ).toThrow(/unresolved variables: definitely_not_a_real_var/);
  });
});

// ---------------------------------------------------------------------------
// loadCellDataset + resolveCell — dataset ingestion with per-cell isolation
// ---------------------------------------------------------------------------

describe("loadCellDataset", () => {
  it("parses the smoke fixture into an array", () => {
    const raw = readFileSync(
      new URL("./fixtures/cells-smoke.json", import.meta.url),
      "utf8",
    );
    const parsed = loadCellDataset(raw);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(4);
  });

  it("throws (file-level) on non-JSON input", () => {
    expect(() => loadCellDataset("{ not json")).toThrow(/not valid JSON/);
  });

  it("throws (file-level) when the top-level value is not an array", () => {
    expect(() => loadCellDataset('{"language":"TR"}')).toThrow(
      /must be a JSON array/,
    );
  });
});

describe("resolveCell", () => {
  it("resolves every descriptor in the smoke fixture to a grammar point", () => {
    const raw = readFileSync(
      new URL("./fixtures/cells-smoke.json", import.meta.url),
      "utf8",
    );
    const dataset = loadCellDataset(raw);
    const resolutions = dataset.map(resolveCell);

    expect(resolutions.every((r) => !isCellResolutionError(r))).toBe(true);
    for (const r of resolutions) {
      if (isCellResolutionError(r)) continue; // narrow for TS
      expect(r.grammarPoint.key).toBe(r.cell.grammarPointKey);
    }
  });

  it("resolves a single valid descriptor to its grammar point", () => {
    const resolution = resolveCell({
      language: "TR",
      cefrLevel: "A1",
      exerciseType: "cloze",
      grammarPointKey: "tr-a1-locative",
    });
    expect(isCellResolutionError(resolution)).toBe(false);
    if (isCellResolutionError(resolution)) throw new Error("unexpected error");
    expect(resolution.grammarPoint).toBe(getGrammarPoint("tr-a1-locative"));
    expect(resolution.cell.language).toBe(Language.TR);
  });

  it("records a per-cell error (no throw) for a malformed shape", () => {
    const resolution = resolveCell({
      language: "TR",
      cefrLevel: "A1",
      // missing exerciseType + grammarPointKey
    });
    expect(isCellResolutionError(resolution)).toBe(true);
    if (!isCellResolutionError(resolution)) throw new Error("expected error");
    expect(resolution.error).toMatch(/malformed cell descriptor/);
  });

  it("records a per-cell error for an unknown grammarPointKey", () => {
    const resolution = resolveCell({
      language: "TR",
      cefrLevel: "A1",
      exerciseType: "cloze",
      grammarPointKey: "tr-a1-does-not-exist",
    });
    expect(isCellResolutionError(resolution)).toBe(true);
    if (!isCellResolutionError(resolution)) throw new Error("expected error");
    expect(resolution.error).toMatch(/unknown grammarPointKey/);
  });

  it("records a per-cell error for an EN cell (not a generation language)", () => {
    const resolution = resolveCell({
      language: "EN",
      cefrLevel: "A1",
      exerciseType: "cloze",
      grammarPointKey: "tr-a1-locative",
    });
    expect(isCellResolutionError(resolution)).toBe(true);
    if (!isCellResolutionError(resolution)) throw new Error("expected error");
    expect(resolution.error).toMatch(/EN is not a generation language/);
  });

  it("records a per-cell error (no throw) for a non-object entry", () => {
    expect(isCellResolutionError(resolveCell(null))).toBe(true);
    expect(isCellResolutionError(resolveCell("nope"))).toBe(true);
    expect(isCellResolutionError(resolveCell(42))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseEvalGenArgs — argv parsing + the no-dataset guard (Req 3.4)
// ---------------------------------------------------------------------------

describe("parseEvalGenArgs", () => {
  it("parses all fields and defaults baseline=repo, drafts-per-cell=5", () => {
    const args = parseEvalGenArgs([
      "--candidate",
      "file:./candidate.txt",
      "--dataset-file",
      "cells.json",
      "--run-name",
      "demo",
      "--allow-prod",
      "--limit",
      "3",
      "--max-cost-usd",
      "1.5",
    ]);
    expect(args).toEqual({
      baseline: "repo",
      candidate: "file:./candidate.txt",
      datasetFile: "cells.json",
      draftsPerCell: 5,
      runName: "demo",
      allowProd: true,
      limit: 3,
      maxCostUsd: 1.5,
    });
  });

  it("throws a usage error when --dataset-file is omitted (Req 3.4)", () => {
    expect(() => parseEvalGenArgs(["--candidate", "repo"])).toThrow(
      /--dataset-file/,
    );
  });

  it("throws when --candidate is omitted", () => {
    expect(() =>
      parseEvalGenArgs(["--dataset-file", "cells.json"]),
    ).toThrow(/--candidate/);
  });

  it("rejects --drafts-per-cell outside 1..200", () => {
    const base = ["--candidate", "repo", "--dataset-file", "cells.json"];
    expect(() =>
      parseEvalGenArgs([...base, "--drafts-per-cell", "0"]),
    ).toThrow(/drafts-per-cell/);
    expect(() =>
      parseEvalGenArgs([...base, "--drafts-per-cell", "201"]),
    ).toThrow(/drafts-per-cell/);
  });

  it("rejects a non-positive --max-cost-usd", () => {
    expect(() =>
      parseEvalGenArgs([
        "--candidate",
        "repo",
        "--dataset-file",
        "cells.json",
        "--max-cost-usd",
        "0",
      ]),
    ).toThrow(/max-cost-usd/);
  });
});

// ---------------------------------------------------------------------------
// runGenEval — orchestration with a stub executor (no live Claude)
// ---------------------------------------------------------------------------

/** A resolved prompt source backed by the real (renderable) template. */
const STUB_SOURCE = (source: string): ResolvedGenerationPromptSource => ({
  templateBody: GENERATION_SYSTEM_PROMPT_TEMPLATE,
  source,
  sha: sha8(source),
});

const argsFor = (over: Partial<EvalGenArgs> = {}): EvalGenArgs => ({
  baseline: "repo",
  candidate: "cand",
  datasetFile: "cells.json",
  draftsPerCell: 2,
  allowProd: false,
  ...over,
});

const cellEntry = (
  grammarPointKey: string,
  language = "TR",
  cefrLevel = "A1",
  exerciseType = "cloze",
): Record<string, string> => ({
  language,
  cefrLevel,
  exerciseType,
  grammarPointKey,
});

/** A fixed arm result; `outputTokens` drives `estimateCostUsd` for cap tests. */
const armResult = (outputTokens = 0): ArmResult => ({
  outcomes: [
    { bucket: "auto-approved", reasons: [] },
    { bucket: "rejected", reasons: ["off-topic"] },
  ],
  usage: { ...ZERO_USAGE, outputTokens },
});

const TR_CELLS = [
  cellEntry("tr-a1-locative"),
  cellEntry("tr-a1-present-continuous"),
  cellEntry("tr-a1-accusative-definite-object"),
];

const runOpts = (over: {
  executor: GenCellArmExecutor;
  dataset: unknown[];
  args?: Partial<EvalGenArgs>;
}) => ({
  executor: over.executor,
  dataset: over.dataset,
  baseline: STUB_SOURCE("repo"),
  candidate: STUB_SOURCE("cand"),
  args: argsFor(over.args),
  runName: "test-run",
  datasetName: "cells.json",
  log: () => {}, // silence orchestrator logging in tests
});

describe("runGenEval", () => {
  it("runs both arms per resolved cell and renders a non-empty prompt", async () => {
    const seen: GenCellArmExecutorParams[] = [];
    const executor: GenCellArmExecutor = vi.fn(async (p) => {
      seen.push(p);
      return armResult();
    });

    const result = await runGenEval(
      runOpts({ executor, dataset: TR_CELLS.slice(0, 2) }),
    );

    // 2 cells × 2 arms = 4 executor calls, all with a rendered override.
    expect(executor).toHaveBeenCalledTimes(4);
    expect(seen.every((p) => p.systemPromptOverride.length > 0)).toBe(true);
    expect(seen.every((p) => p.draftsPerCell === 2)).toBe(true);
    expect(result.cells).toHaveLength(2);
    for (const c of result.cells) {
      expect(c.baseline.outcomes).toHaveLength(2);
      expect(c.candidate.outcomes).toHaveLength(2);
    }
    expect(result.errors).toHaveLength(0);
    expect(result.costCapped).toBe(false);
  });

  it("isolates a cell whose executor throws; other cells still complete", async () => {
    const executor: GenCellArmExecutor = vi.fn(async (p) => {
      if (p.cell.grammarPointKey === "tr-a1-present-continuous") {
        throw new Error("boom on cell 2");
      }
      return armResult();
    });

    const result = await runGenEval(
      runOpts({ executor, dataset: TR_CELLS }),
    );

    // Cells 1 and 3 compared; cell 2 surfaced as a per-cell error.
    expect(result.cells.map((c) => c.cellKey)).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/boom on cell 2/);
    expect(result.errors[0].cellKey).toContain("tr-a1-present-continuous");
  });

  it("records resolution failures without invoking the executor", async () => {
    const executor: GenCellArmExecutor = vi.fn(async () => armResult());

    const result = await runGenEval(
      runOpts({
        executor,
        dataset: [
          cellEntry("tr-a1-locative"),
          cellEntry("tr-a1-nope-unknown"), // unknown key → resolution error
        ],
      }),
    );

    expect(result.cells).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/unknown grammarPointKey/);
    // Only the valid cell ran (2 arms); the unresolved cell never reached it.
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("stops at a cell boundary when --max-cost-usd is reached (coherent partial)", async () => {
    // Each arm bills 100k output tokens = $1.50; a full cell = $3.00.
    const executor: GenCellArmExecutor = vi.fn(async () => armResult(100_000));

    const result = await runGenEval(
      runOpts({
        executor,
        dataset: TR_CELLS, // 3 cells available
        args: { maxCostUsd: 2 }, // tripped after the first full cell ($3 ≥ $2)
      }),
    );

    expect(result.costCapped).toBe(true);
    // Exactly one fully-compared cell — no half-compared cell in the summary.
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0].baseline.outcomes).toHaveLength(2);
    expect(result.cells[0].candidate.outcomes).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    // 1 cell × 2 arms — the loop broke before dispatching cell 2.
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("caps the number of cells processed with --limit", async () => {
    const executor: GenCellArmExecutor = vi.fn(async () => armResult());

    const result = await runGenEval(
      runOpts({ executor, dataset: TR_CELLS, args: { limit: 1 } }),
    );

    expect(result.cells).toHaveLength(1);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(result.costCapped).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// makeRealArmExecutor — draft classification + cost folding (mocked Claude)
// ---------------------------------------------------------------------------

const mockGenerateBatch = vi.mocked(generateBatch);
const mockValidateDraft = vi.mocked(validateDraft);

/** A ValidationResult that `routeValidationResult` auto-approves. */
const approveResult = (): ValidationResult => ({
  qualityScore: 0.9,
  ambiguous: false,
  contextSpoilsAnswer: false,
  levelMatch: true,
  grammarPointMatch: true,
  culturalIssues: [],
  flaggedReasons: [],
});

/** Quality ≥ floors but `ambiguous` → routes to `flagged` with `["ambiguous"]`. */
const flaggedResult = (): ValidationResult => ({
  qualityScore: 0.8,
  ambiguous: true,
  contextSpoilsAnswer: false,
  levelMatch: true,
  grammarPointMatch: true,
  culturalIssues: [],
  flaggedReasons: [],
});

/** qualityScore < flagQualityFloor (0.5) → hard reject. */
const rejectedResult = (): ValidationResult => ({
  qualityScore: 0.3,
  ambiguous: false,
  contextSpoilsAnswer: false,
  levelMatch: true,
  grammarPointMatch: true,
  culturalIssues: [],
  flaggedReasons: [],
});

const usage = (over: Partial<ClaudeUsageBreakdown>): ClaudeUsageBreakdown => ({
  ...ZERO_USAGE,
  ...over,
});

describe("makeRealArmExecutor — classification + cost folding", () => {
  beforeEach(() => {
    mockGenerateBatch.mockReset();
    mockValidateDraft.mockReset();
  });

  it("routes drafts via real routeValidationResult, buckets malformed, folds usage", async () => {
    const grammarPoint = getGrammarPoint("tr-a1-locative");
    if (!grammarPoint) throw new Error("fixture key missing");
    const cell: CellDescriptor = {
      language: Language.TR,
      cefrLevel: CefrLevel.A1,
      exerciseType: ExerciseType.CLOZE,
      grammarPointKey: "tr-a1-locative",
    };

    // generation usage already folds the malformed draft's tokens (per
    // GenerateBatchResult contract); 3 well-formed drafts + 1 malformed.
    const GEN_USAGE = usage({ inputTokens: 1000, outputTokens: 500 });
    const VAL_USAGE = usage({ inputTokens: 100, outputTokens: 50 });

    mockGenerateBatch.mockResolvedValue({
      drafts: [{ id: "d1" }, { id: "d2" }, { id: "d3" }] as ExerciseDraft[],
      tokenUsage: GEN_USAGE,
      malformedDrafts: [
        { ordinal: 4, errorMessage: "Draft ordinal=4 malformed: bad json" },
      ],
    } satisfies GenerateBatchResult);

    const wrap = (result: ValidationResult): ValidateDraftResult => ({
      result,
      tokenUsage: VAL_USAGE,
    });
    mockValidateDraft
      .mockResolvedValueOnce(wrap(approveResult()))
      .mockResolvedValueOnce(wrap(flaggedResult()))
      .mockResolvedValueOnce(wrap(rejectedResult()));

    const executor = makeRealArmExecutor({} as never);
    const arm = await executor({
      cell,
      grammarPoint,
      systemPromptOverride: "SYSTEM PROMPT BODY",
      draftsPerCell: 3,
      batchSeed: "eval-gen",
    });

    // --- Classification: one of each bucket, in draft order then malformed.
    expect(arm.outcomes.map((o) => o.bucket)).toEqual([
      "auto-approved",
      "flagged",
      "rejected",
      "parser-failure",
    ]);
    const byBucket = (b: string) => arm.outcomes.find((o) => o.bucket === b)!;
    expect(byBucket("flagged").reasons).toEqual(["ambiguous"]);
    expect(byBucket("rejected").reasons).toEqual(["low quality score (<0.5)"]);
    expect(byBucket("parser-failure").reasons).toEqual(["parser-failure"]);

    // --- Spec passed to generateBatch carries the override + cell config.
    const spec = mockGenerateBatch.mock.calls[0][1];
    expect(spec.systemPromptOverride).toBe("SYSTEM PROMPT BODY");
    expect(spec.count).toBe(3);
    expect(spec.topicDomain).toBeNull();
    expect(spec.grammarPoint).toBe(grammarPoint);

    // --- Cost folding: generation usage (incl. the malformed draft's tokens,
    // baked into GEN_USAGE) + every validateDraft usage. 1000+3×100 input,
    // 500+3×50 output.
    const expected = addUsage(
      GEN_USAGE,
      addUsage(addUsage(VAL_USAGE, VAL_USAGE), VAL_USAGE),
    );
    expect(arm.usage).toEqual(expected);
    expect(arm.usage.inputTokens).toBe(1300);
    expect(arm.usage.outputTokens).toBe(650);
    // Folding validation usage strictly increases cost over generation alone.
    expect(estimateCostUsd(arm.usage)).toBeGreaterThan(
      estimateCostUsd(GEN_USAGE),
    );
  });
});

// ---------------------------------------------------------------------------
// computeGenDiff + renderMarkdownSummary — pure rollup + decision-grade output
// ---------------------------------------------------------------------------

const AO: DraftOutcome = { bucket: "auto-approved", reasons: [] };
const REJ: DraftOutcome = {
  bucket: "rejected",
  reasons: ["low quality score (<0.5)"],
};
const FL: DraftOutcome = { bucket: "flagged", reasons: ["ambiguous"] };
const PF: DraftOutcome = { bucket: "parser-failure", reasons: ["parser-failure"] };

const armOf = (
  outcomes: DraftOutcome[],
  outputTokens: number,
): ArmResult => ({ outcomes, usage: usage({ outputTokens }) });

/**
 * A 2-cell run with hand-picked outcomes so every rolled-up stat is exactly
 * predictable:
 *   baseline  → 4 drafts: 2 auto-approved, 1 flagged(ambiguous), 1 rejected
 *               → approvalRate 0.5; 200 output tokens total
 *   candidate → 4 drafts: 3 auto-approved, 1 parser-failure
 *               → approvalRate 0.75; 400 output tokens total
 */
const sampleRun = (costCapped = false): GenEvalRunResult => ({
  runName: "diff-run",
  baseline: { source: "repo", sha: "base1234" },
  candidate: { source: "cand", sha: "cand5678" },
  datasetName: "cells.json",
  startedAt: "2026-06-02T00:00:00.000Z",
  draftsPerCell: 2,
  costCapped,
  cells: [
    {
      cellKey: "TR|A1|cloze|tr-a1-locative",
      baseline: armOf([AO, REJ], 100),
      candidate: armOf([AO, AO], 200),
    },
    {
      cellKey: "TR|A1|vocab_recall|tr-a1-present-continuous",
      baseline: armOf([FL, AO], 100),
      candidate: armOf([AO, PF], 200),
    },
  ],
  errors: [
    {
      cellKey: "ES|B1|cloze|es-b1-bad",
      error: "unknown grammarPointKey 'es-b1-bad'",
    },
  ],
});

describe("computeGenDiff", () => {
  it("rolls per-cell arm results into exact aggregate stats + deltas", () => {
    const summary = computeGenDiff(sampleRun());

    expect(summary.cellCount).toBe(2);
    expect(summary.draftsPerCell).toBe(2);

    // Baseline arm
    expect(summary.baselineStats).toMatchObject({
      totalDrafts: 4,
      autoApproved: 2,
      flagged: 1,
      rejected: 1,
      parserFailure: 0,
      approvalRate: 0.5,
      rejectionReasonCounts: { "low quality score (<0.5)": 1 },
      flagTagCounts: { ambiguous: 1 },
    });

    // Candidate arm
    expect(summary.candidateStats).toMatchObject({
      totalDrafts: 4,
      autoApproved: 3,
      flagged: 0,
      rejected: 0,
      parserFailure: 1,
      approvalRate: 0.75,
      rejectionReasonCounts: {},
      flagTagCounts: { "parser-failure": 1 },
    });

    // Deltas
    expect(summary.approvalRateDelta).toBeCloseTo(0.25, 10);
    expect(summary.reasonDeltas).toEqual({
      "low quality score (<0.5)": { baseline: 1, candidate: 0 },
    });
    expect(summary.flagDeltas).toEqual({
      ambiguous: { baseline: 1, candidate: 0 },
      "parser-failure": { baseline: 0, candidate: 1 },
    });

    // Per-arm cost from the folded usage (200 vs 400 output tokens).
    expect(summary.costUsd.baseline).toBe(
      estimateCostUsd(usage({ outputTokens: 200 })),
    );
    expect(summary.costUsd.candidate).toBe(
      estimateCostUsd(usage({ outputTokens: 400 })),
    );
    expect(summary.costUsd.candidate).toBeGreaterThan(summary.costUsd.baseline);

    // perCell is retained for the JSON file (one entry per compared cell).
    expect(summary.perCell).toHaveLength(2);
    expect(summary.errors).toHaveLength(1);
  });
});

describe("renderMarkdownSummary", () => {
  it("renders the documented headers, rows, deltas, and errors section", () => {
    const md = renderMarkdownSummary(computeGenDiff(sampleRun()));

    // Header block
    expect(md).toContain("# Generation eval run `diff-run`");
    expect(md).toContain("**baseline:** repo (sha base1234)");
    expect(md).toContain("**candidate:** cand (sha cand5678)");
    expect(md).toContain("**dataset:** cells.json");

    // Approval-rate table: baseline | candidate | Δ
    expect(md).toContain("## Approval rate & buckets");
    expect(md).toMatch(/\| approval rate \| 50\.0% \| 75\.0% \| \+25pp \|/);
    expect(md).toContain("| parser-failure | 0 | 1 |");

    // Reason + flag delta tables
    expect(md).toContain("## Rejection reasons");
    expect(md).toContain("| low quality score (<0.5) | 1 | 0 |");
    expect(md).toContain("## Flag tags");
    expect(md).toContain("| ambiguous | 1 | 0 |");

    // Cost row (200 → $0.0030, 400 → $0.0060)
    expect(md).toContain("## Cost");
    expect(md).toContain("| cost USD | $0.0030 | $0.0060 |");

    // Errors section
    expect(md).toContain("## Errors (1)");
    expect(md).toContain(
      "- `ES|B1|cloze|es-b1-bad`: unknown grammarPointKey 'es-b1-bad'",
    );
  });

  it("includes the cost-cap note only when the run is cost-capped", () => {
    const capped = renderMarkdownSummary(computeGenDiff(sampleRun(true)));
    const normal = renderMarkdownSummary(computeGenDiff(sampleRun(false)));
    expect(capped).toContain("cost cap reached");
    expect(normal).not.toContain("cost cap reached");
  });
});
