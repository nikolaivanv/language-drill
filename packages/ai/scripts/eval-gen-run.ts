/**
 * packages/ai — eval-gen-run CLI (generation-quality eval harness).
 *
 * The generation-side analogue of `eval-run.ts`. Compares two generation-prompt
 * sources (baseline vs. candidate) over a dataset of *cells*
 * (`language, cefrLevel, exerciseType, grammarPointKey`): for each cell it
 * renders each prompt into a concrete system prompt, generates N drafts under
 * each via `generateBatch`, validates every draft with `validateDraft`, routes
 * each verdict through `routeValidationResult`, and reports the approval-rate /
 * rejection-reason / flag-tag distribution deltas — markdown to stdout and a
 * full JSON summary to `./eval-runs/<runName>.json`.
 *
 * Invocation (see Task 12 for the CLI):
 *   tsx scripts/eval-gen-run.ts \
 *     --baseline repo --candidate file:./candidate.txt \
 *     --dataset-file packages/ai/scripts/fixtures/cells-smoke.json \
 *     [--drafts-per-cell 5] [--limit <n>] [--run-name <name>]
 *     [--allow-prod] [--max-cost-usd <n>]
 *
 * This module is built bottom-up; this file currently declares only the typed
 * contracts (Task 5). Logic lands in later tasks (resolver → loader → executor
 * → orchestrator → diff → render → CLI).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type Anthropic from "@anthropic-ai/sdk";

import { CefrLevel, ExerciseType, Language } from "@language-drill/shared";
import type { GrammarPoint } from "@language-drill/shared";
import {
  buildCellKey,
  getGrammarPoint,
  routeValidationResult,
} from "@language-drill/db";

import {
  GENERATION_SYSTEM_PROMPT_TEMPLATE,
  ZERO_USAGE,
  addUsage,
  applyTemplate,
  createClaudeClient,
  estimateCostUsd,
  generateBatch,
  getLangfuse,
  validateDraft,
  type ClaudeUsageBreakdown,
  type GenerationPromptInputs,
  type GenerationSpec,
} from "../src/index.js";
// `computeGenerationPromptVars` is not on the `@language-drill/ai` barrel —
// same deep-relative pattern `eval-run.ts` uses for `sha8`.
import { computeGenerationPromptVars } from "../src/generation-prompts.js";
import { sha8 } from "../src/prompts-registry.js";
import {
  EVAL_RUNS_DIR,
  assertNotProdWithoutAllow,
  deriveRunName,
  writeSummaryJson,
  type EvalRunSummary,
  type LangfusePromptFetcher,
} from "./eval-run.js";

// ---------------------------------------------------------------------------
// Dataset descriptor — one row of the `--dataset-file` JSON array.
// ---------------------------------------------------------------------------

/**
 * A single cell to evaluate. `grammarPointKey` is resolved to a full
 * `GrammarPoint` at load time via `getGrammarPoint`; `language === EN` is
 * rejected there too (EN is not a generation language).
 */
export type CellDescriptor = {
  language: Language;
  cefrLevel: CefrLevel;
  exerciseType: ExerciseType;
  grammarPointKey: string;
};

/** A descriptor that passed shape + curriculum + non-EN validation. */
export type ResolvedCell = {
  cell: CellDescriptor;
  grammarPoint: GrammarPoint;
};

/** A descriptor that failed validation — surfaced in `GenEvalSummary.errors`. */
export type CellResolutionError = {
  cellKey: string;
  error: string;
};

export type CellResolution = ResolvedCell | CellResolutionError;

/** Narrow a `CellResolution` to its error arm. */
export function isCellResolutionError(
  r: CellResolution,
): r is CellResolutionError {
  return "error" in r;
}

const isLanguage = (v: unknown): v is Language =>
  typeof v === "string" && (Object.values(Language) as string[]).includes(v);
const isCefrLevel = (v: unknown): v is CefrLevel =>
  typeof v === "string" && (Object.values(CefrLevel) as string[]).includes(v);
const isExerciseType = (v: unknown): v is ExerciseType =>
  typeof v === "string" && (Object.values(ExerciseType) as string[]).includes(v);

/**
 * Parse + structurally validate the `--dataset-file` contents. Throws only on
 * a *file-level* error (not valid JSON, or not a JSON array) — a malformed
 * *entry* is not rejected here; it is isolated per-cell by `resolveCell` so one
 * bad row never aborts the run (Req 3.1, 4.6). Returns the raw elements
 * untyped; each is validated downstream.
 */
export function loadCellDataset(raw: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `[eval-gen] dataset file is not valid JSON: ${(e as Error).message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      "[eval-gen] dataset file must be a JSON array of cell descriptors",
    );
  }
  return parsed;
}

/**
 * Resolve one (untyped) dataset entry to a full `ResolvedCell`, or a
 * `CellResolutionError` for: a malformed shape (non-object / bad enum / missing
 * `grammarPointKey`), an unknown `grammarPointKey` (absent from the curriculum),
 * or `language === EN` (not a generation language — rejected here so it surfaces
 * as a per-cell error rather than an opaque mid-run `generateBatch` throw).
 * Never throws (Req 3.1, 3.2, 4.6).
 */
export function resolveCell(descriptor: unknown): CellResolution {
  if (typeof descriptor !== "object" || descriptor === null) {
    return {
      cellKey: "<malformed>",
      error: `cell descriptor is not an object (got ${JSON.stringify(descriptor)})`,
    };
  }

  const d = descriptor as Record<string, unknown>;
  const { language, cefrLevel, exerciseType, grammarPointKey } = d;

  // Best-effort cell key for the error line, using sentinels for bad fields.
  const cellKey = buildCellKey({
    language: typeof language === "string" ? language : "?",
    cefrLevel: typeof cefrLevel === "string" ? cefrLevel : "?",
    exerciseType: typeof exerciseType === "string" ? exerciseType : "?",
    grammarPointKey: typeof grammarPointKey === "string" ? grammarPointKey : "?",
  });

  if (
    !isLanguage(language) ||
    !isCefrLevel(cefrLevel) ||
    !isExerciseType(exerciseType) ||
    typeof grammarPointKey !== "string" ||
    grammarPointKey === ""
  ) {
    return {
      cellKey,
      error: `malformed cell descriptor (got ${JSON.stringify(descriptor)})`,
    };
  }

  if (language === Language.EN) {
    return { cellKey, error: "EN is not a generation language" };
  }

  const grammarPoint = getGrammarPoint(grammarPointKey);
  if (!grammarPoint) {
    return {
      cellKey,
      error: `unknown grammarPointKey '${grammarPointKey}' (not in curriculum)`,
    };
  }

  return {
    cell: { language, cefrLevel, exerciseType, grammarPointKey },
    grammarPoint,
  };
}

// ---------------------------------------------------------------------------
// Per-draft outcome — how one generated draft routed through validation.
// ---------------------------------------------------------------------------

/**
 * The four terminal states a draft can land in. `parser-failure` is a draft
 * the generator returned malformed (never reached validation); it is
 * non-approved and tracked as its own distribution key.
 */
export type DraftBucket =
  | "auto-approved"
  | "flagged"
  | "rejected"
  | "parser-failure";

/**
 * One classified draft. `reasons` are the routed reason/flag strings from
 * `routeValidationResult`; a malformed draft carries `["parser-failure"]`.
 */
export type DraftOutcome = {
  bucket: DraftBucket;
  reasons: string[];
};

/**
 * The result of running one arm (baseline or candidate) over a single cell:
 * every draft's outcome plus the folded token usage (including the usage of
 * malformed drafts, which is still billed). `error` is set when the arm threw,
 * in which case `outcomes` is empty and the cell is recorded in
 * `GenEvalSummary.errors`.
 */
export type ArmResult = {
  outcomes: DraftOutcome[];
  usage: ClaudeUsageBreakdown;
  error?: string;
};

// ---------------------------------------------------------------------------
// Rolled-up statistics — one arm, across all cells.
// ---------------------------------------------------------------------------

/**
 * Aggregate stats for one arm over the whole dataset. `approvalRate` is
 * `autoApproved / totalDrafts`. `rejectionReasonCounts` / `flagTagCounts` are
 * keyed by the routed reason/flag strings (with `parser-failure` as its own
 * flag key). `costUsd` is `estimateCostUsd` over the folded usage.
 */
export type ArmStats = {
  totalDrafts: number;
  autoApproved: number;
  flagged: number;
  rejected: number;
  parserFailure: number;
  approvalRate: number;
  rejectionReasonCounts: Record<string, number>;
  flagTagCounts: Record<string, number>;
  costUsd: number;
};

// ---------------------------------------------------------------------------
// Decision-grade summary — written to stdout (markdown) + JSON file.
// ---------------------------------------------------------------------------

/**
 * The full comparison summary. `perCell` is included in the JSON file but
 * omitted from the markdown render. Deltas are `candidate - baseline`
 * (positive `approvalRateDelta` means the candidate approves more).
 */
export type GenEvalSummary = {
  runName: string;
  baseline: { source: string; sha: string };
  candidate: { source: string; sha: string };
  datasetName: string;
  startedAt: string;
  cellCount: number;
  draftsPerCell: number;
  costCapped: boolean;
  baselineStats: ArmStats;
  candidateStats: ArmStats;
  /** candidate - baseline */
  approvalRateDelta: number;
  reasonDeltas: Record<string, { baseline: number; candidate: number }>;
  flagDeltas: Record<string, { baseline: number; candidate: number }>;
  costUsd: { baseline: number; candidate: number };
  errors: Array<{ cellKey: string; error: string }>;
  perCell?: Array<{ cellKey: string; baseline: ArmStats; candidate: ArmStats }>;
};

// ---------------------------------------------------------------------------
// CLI argv shape — parsed by `parseEvalGenArgs` (Task 12).
// ---------------------------------------------------------------------------

export type EvalGenArgs = {
  /** `repo`, `file:<path>`, or `langfuse:<name>@<label>`. */
  baseline: string;
  /** `repo`, `file:<path>`, or `langfuse:<name>@<label>`. */
  candidate: string;
  /** Path to the JSON array of `CellDescriptor`s. Required. */
  datasetFile: string;
  /** Drafts generated per cell per arm; default 5, clamped to 1..200. */
  draftsPerCell: number;
  /** Cap on the number of cells processed. */
  limit?: number;
  runName?: string;
  allowProd: boolean;
  /** Hard cost ceiling (USD); checked at each cell boundary. */
  maxCostUsd?: number;
};

// ---------------------------------------------------------------------------
// Prompt-source resolution — `repo`, `file:<path>`, or `langfuse:<name>@<label>`
// ---------------------------------------------------------------------------

/** A resolved generation-prompt *template body* (pre-render). */
export type ResolvedGenerationPromptSource = {
  /** The raw `{{var}}` template, before `renderSystemPrompt`. */
  templateBody: string;
  /** Raw argv value — round-tripped into the summary for dashboards. */
  source: string;
  /** `sha8` of `templateBody`, for cohorting runs by prompt. */
  sha: string;
};

/**
 * Resolve a `--baseline` / `--candidate` argument to a generation template
 * body (the `{{var}}` form, not yet rendered for a cell):
 *
 *   - `repo` → the in-repo `GENERATION_SYSTEM_PROMPT_TEMPLATE` fallback.
 *   - `file:<path>` → `readFileSync(path, "utf8")`.
 *   - `langfuse:<name>@<label>` → `getPrompt(name, undefined, {label})`;
 *     `langfuse:<name>` defaults to `label = "candidate"` (operator
 *     convention, mirroring `resolveCandidate`).
 *
 * Throws on any other prefix or an empty langfuse name so a typo can't
 * silently run the eval against an empty prompt.
 */
export async function resolveGenerationPromptSource(
  source: string,
  langfuse: LangfusePromptFetcher,
  options: { readFile?: (path: string) => string } = {},
): Promise<ResolvedGenerationPromptSource> {
  const readFile = options.readFile ?? ((p) => readFileSync(p, "utf8"));

  const withSha = (
    templateBody: string,
  ): ResolvedGenerationPromptSource => ({
    templateBody,
    source,
    sha: sha8(templateBody),
  });

  if (source === "repo") {
    return withSha(GENERATION_SYSTEM_PROMPT_TEMPLATE);
  }
  if (source.startsWith("file:")) {
    const path = source.slice("file:".length);
    return withSha(readFile(path));
  }
  if (source.startsWith("langfuse:")) {
    const spec = source.slice("langfuse:".length);
    const at = spec.lastIndexOf("@");
    const name = at >= 0 ? spec.slice(0, at) : spec;
    const label = at >= 0 ? spec.slice(at + 1) : "candidate";
    if (name === "") {
      throw new Error(
        `[eval-gen] invalid prompt source: empty name in '${source}'`,
      );
    }
    const prompt = await langfuse.getPrompt(name, undefined, { label });
    if (typeof prompt.prompt !== "string") {
      throw new Error(
        `[eval-gen] prompt source '${source}' resolved with no prompt body`,
      );
    }
    return withSha(prompt.prompt);
  }
  throw new Error(
    `[eval-gen] unsupported prompt source '${source}' ` +
      `(expected repo, file:<path>, or langfuse:<name>@<label>)`,
  );
}

/**
 * Render a resolved template body into a concrete system prompt for one cell,
 * substituting the same variable map the production builder computes —
 * `computeGenerationPromptVars(inputs, [])` (empty `recentStems` to match
 * `generateOneDraft`). Throws if the template references a `{{var}}` not in the
 * computed map, so a prompt-source mistake fails fast before any Claude spend.
 */
export function renderSystemPrompt(
  templateBody: string,
  inputs: GenerationPromptInputs,
): string {
  const { text, missingVars } = applyTemplate(
    templateBody,
    computeGenerationPromptVars(inputs, []),
  );
  if (missingVars.length > 0) {
    throw new Error(
      `[eval-gen] template references unresolved variables: ${missingVars.join(", ")}`,
    );
  }
  return text;
}

// ---------------------------------------------------------------------------
// Arm executor — generate N drafts under one prompt, validate + classify each.
// ---------------------------------------------------------------------------

/** Everything one arm (baseline or candidate) needs to run a single cell. */
export type GenCellArmExecutorParams = {
  cell: CellDescriptor;
  grammarPoint: GrammarPoint;
  /** The system prompt body already rendered for this cell + arm. */
  systemPromptOverride: string;
  draftsPerCell: number;
  batchSeed: string;
  signal?: AbortSignal;
};

/**
 * Port: run one arm over one cell and return its classified outcomes + folded
 * usage. Injected into the orchestrator so tests can stub Claude entirely.
 */
export type GenCellArmExecutor = (
  params: GenCellArmExecutorParams,
) => Promise<ArmResult>;

/** Map a routed `reviewStatus` to its (non-parser-failure) `DraftBucket`. */
function bucketForReviewStatus(
  reviewStatus: ReturnType<typeof routeValidationResult>["reviewStatus"],
): Exclude<DraftBucket, "parser-failure"> {
  if (reviewStatus === "auto-approved") return "auto-approved";
  if (reviewStatus === "flagged") return "flagged";
  // 'rejected' (and the unreachable 'manual-approved', which
  // routeValidationResult never returns) collapse to rejected.
  return "rejected";
}

/**
 * The real per-arm executor. Builds a `GenerationSpec` carrying the rendered
 * `systemPromptOverride` (so the candidate prompt drives generation without a
 * Langfuse fetch), generates `draftsPerCell` drafts via `generateBatch`, then
 * validates each well-formed draft with `validateDraft` and routes the verdict
 * through `routeValidationResult` into a bucket. Malformed drafts (parser
 * failures, which never reach the validator) become `parser-failure` outcomes.
 *
 * Cost folding (Req 4.4): `generateBatch`'s `tokenUsage` already includes the
 * tokens spent on malformed drafts, and every `validateDraft` usage is added on
 * top — nothing is discarded.
 *
 * Infrastructure failures (network, 429, abort) propagate; the orchestrator
 * (Task 9) isolates them per cell.
 */
export function makeRealArmExecutor(client: Anthropic): GenCellArmExecutor {
  return async ({
    cell,
    grammarPoint,
    systemPromptOverride,
    draftsPerCell,
    batchSeed,
    signal,
  }: GenCellArmExecutorParams): Promise<ArmResult> => {
    const spec: GenerationSpec = {
      // EN is rejected at `resolveCell`, so this narrowing cast is safe; the
      // generator also guards EN at runtime.
      language: cell.language as Exclude<Language, Language.EN>,
      cefrLevel: cell.cefrLevel,
      exerciseType: cell.exerciseType,
      grammarPoint,
      topicDomain: null,
      count: draftsPerCell,
      batchSeed,
      systemPromptOverride,
    };

    const batch = await generateBatch(client, spec, signal);

    // Seed usage with the generation total (already folds malformed-draft
    // tokens), then add each validation call's usage.
    let usage: ClaudeUsageBreakdown = batch.tokenUsage;
    const outcomes: DraftOutcome[] = [];

    for (const draft of batch.drafts) {
      const { result, tokenUsage } = await validateDraft(
        client,
        draft,
        spec,
        signal,
      );
      usage = addUsage(usage, tokenUsage);
      const { reviewStatus, flaggedReasons } = routeValidationResult(result);
      outcomes.push({
        bucket: bucketForReviewStatus(reviewStatus),
        reasons: flaggedReasons,
      });
    }

    // Each malformed draft is a distinct parser-failure outcome (Req 4.4).
    for (let i = 0; i < batch.malformedDrafts.length; i++) {
      outcomes.push({ bucket: "parser-failure", reasons: ["parser-failure"] });
    }

    return { outcomes, usage };
  };
}

// ---------------------------------------------------------------------------
// Orchestrator — loop cells × arms, fault-isolated, cost-bounded.
// ---------------------------------------------------------------------------

/** One fully-compared cell: both arms ran to completion. */
export type GenCellRecord = {
  cellKey: string;
  baseline: ArmResult;
  candidate: ArmResult;
};

/** Raw orchestration output, rolled up into a `GenEvalSummary` by `computeGenDiff`. */
export type GenEvalRunResult = {
  runName: string;
  baseline: { source: string; sha: string };
  candidate: { source: string; sha: string };
  datasetName: string;
  startedAt: string;
  draftsPerCell: number;
  /** True if the run stopped early at a cell boundary on `--max-cost-usd`. */
  costCapped: boolean;
  /** Cells where both arms completed (the comparison set). */
  cells: GenCellRecord[];
  /** Resolution failures + cells whose arms threw. */
  errors: Array<{ cellKey: string; error: string }>;
};

/** Batch seed for the eval generator — fixed; the harness never inserts. */
const DEFAULT_BATCH_SEED = "eval-gen";

/**
 * Drive both arms (baseline, then candidate) over every cell with three
 * guarantees:
 *
 *   - **Fault isolation (Req 4.6):** a cell whose resolution fails or whose
 *     executor throws is recorded in `errors` and the loop continues; one bad
 *     cell never aborts the run.
 *   - **Cell-boundary cost cap (Req 6.2):** after both arms of a cell finish,
 *     the accumulated `estimateCostUsd` is checked against `--max-cost-usd`;
 *     if reached, `costCapped` is set and the loop stops *before* the next
 *     cell — so a partial summary never holds a half-compared cell.
 *   - **`--limit`:** caps how many dataset entries are attempted.
 *
 * The executor is injected (Req 4.x DI) so tests run without live Claude.
 * Rendering happens here (not in the executor) so a missing-`{{var}}` template
 * fails the cell before any spend (Error Scenario 2).
 */
export async function runGenEval(opts: {
  executor: GenCellArmExecutor;
  dataset: unknown[];
  baseline: ResolvedGenerationPromptSource;
  candidate: ResolvedGenerationPromptSource;
  args: EvalGenArgs;
  runName: string;
  datasetName: string;
  batchSeed?: string;
  signal?: AbortSignal;
  now?: () => Date;
  log?: (...args: unknown[]) => void;
}): Promise<GenEvalRunResult> {
  const {
    executor,
    dataset,
    baseline,
    candidate,
    args,
    runName,
    datasetName,
    batchSeed = DEFAULT_BATCH_SEED,
    signal,
    now = () => new Date(),
    log = (...a: unknown[]) => console.log(...a),
  } = opts;

  const startedAt = now().toISOString();
  const entries =
    args.limit !== undefined ? dataset.slice(0, args.limit) : dataset;

  log(
    `[eval-gen] dataset=${datasetName} cells=${entries.length} ` +
      `draftsPerCell=${args.draftsPerCell} runName=${runName} ` +
      `baseline=${baseline.sha} candidate=${candidate.sha}`,
  );

  const cells: GenCellRecord[] = [];
  const errors: Array<{ cellKey: string; error: string }> = [];
  let costCapped = false;
  let accumulatedUsage: ClaudeUsageBreakdown = ZERO_USAGE;

  for (const entry of entries) {
    const resolution = resolveCell(entry);
    if (isCellResolutionError(resolution)) {
      errors.push(resolution);
      continue;
    }

    const { cell, grammarPoint } = resolution;
    const cellKey = buildCellKey(cell);

    try {
      const inputs: GenerationPromptInputs = {
        // EN already rejected at resolveCell; cast is safe.
        language: cell.language as Exclude<Language, Language.EN>,
        cefrLevel: cell.cefrLevel,
        exerciseType: cell.exerciseType,
        grammarPoint,
      };
      // Render both arms up front — a bad template throws here, before spend.
      const baselinePrompt = renderSystemPrompt(baseline.templateBody, inputs);
      const candidatePrompt = renderSystemPrompt(candidate.templateBody, inputs);

      const baselineResult = await executor({
        cell,
        grammarPoint,
        systemPromptOverride: baselinePrompt,
        draftsPerCell: args.draftsPerCell,
        batchSeed,
        signal,
      });
      const candidateResult = await executor({
        cell,
        grammarPoint,
        systemPromptOverride: candidatePrompt,
        draftsPerCell: args.draftsPerCell,
        batchSeed,
        signal,
      });

      cells.push({ cellKey, baseline: baselineResult, candidate: candidateResult });
      accumulatedUsage = addUsage(
        addUsage(accumulatedUsage, baselineResult.usage),
        candidateResult.usage,
      );
    } catch (e) {
      // Both-arm failure for this cell: record and continue. Partial usage from
      // a half-run cell is intentionally not accrued (the cell is excluded from
      // the comparison entirely).
      errors.push({ cellKey, error: (e as Error).message });
    }

    if (
      args.maxCostUsd !== undefined &&
      estimateCostUsd(accumulatedUsage) >= args.maxCostUsd
    ) {
      costCapped = true;
      log(
        `[eval-gen] cost cap hit (${estimateCostUsd(accumulatedUsage)} >= ${args.maxCostUsd} USD); ` +
          `stopping at cell boundary after ${cells.length} compared cell(s)`,
      );
      break;
    }
  }

  return {
    runName,
    baseline: { source: baseline.source, sha: baseline.sha },
    candidate: { source: candidate.source, sha: candidate.sha },
    datasetName,
    startedAt,
    draftsPerCell: args.draftsPerCell,
    costCapped,
    cells,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Diff layer (pure) — roll per-cell arm results into a decision-grade summary.
// ---------------------------------------------------------------------------

/**
 * Aggregate a list of one arm's per-cell results into `ArmStats`. Pass all
 * cells' baseline (or candidate) results for the run-level stats, or a
 * single-element array for a per-cell row.
 *
 * Reason bookkeeping: `rejected` drafts' routed reasons accumulate into
 * `rejectionReasonCounts`; `flagged` drafts' tags into `flagTagCounts`;
 * `parser-failure` drafts contribute their `"parser-failure"` reason to
 * `flagTagCounts` (its own key), so a malformed-draft spike is visible in the
 * flag distribution (Req 5.2, 5.3).
 */
function computeArmStats(results: ArmResult[]): ArmStats {
  let totalDrafts = 0;
  let autoApproved = 0;
  let flagged = 0;
  let rejected = 0;
  let parserFailure = 0;
  const rejectionReasonCounts: Record<string, number> = {};
  const flagTagCounts: Record<string, number> = {};
  let usage: ClaudeUsageBreakdown = ZERO_USAGE;

  const bump = (counts: Record<string, number>, reasons: string[]): void => {
    for (const reason of reasons) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
  };

  for (const r of results) {
    usage = addUsage(usage, r.usage);
    for (const outcome of r.outcomes) {
      totalDrafts++;
      switch (outcome.bucket) {
        case "auto-approved":
          autoApproved++;
          break;
        case "flagged":
          flagged++;
          bump(flagTagCounts, outcome.reasons);
          break;
        case "rejected":
          rejected++;
          bump(rejectionReasonCounts, outcome.reasons);
          break;
        case "parser-failure":
          parserFailure++;
          bump(flagTagCounts, outcome.reasons);
          break;
      }
    }
  }

  return {
    totalDrafts,
    autoApproved,
    flagged,
    rejected,
    parserFailure,
    approvalRate: totalDrafts > 0 ? autoApproved / totalDrafts : 0,
    rejectionReasonCounts,
    flagTagCounts,
    costUsd: estimateCostUsd(usage),
  };
}

/** Union the keys of two count maps into `{ baseline, candidate }` rows. */
function buildDeltas(
  baselineCounts: Record<string, number>,
  candidateCounts: Record<string, number>,
): Record<string, { baseline: number; candidate: number }> {
  const deltas: Record<string, { baseline: number; candidate: number }> = {};
  for (const key of new Set([
    ...Object.keys(baselineCounts),
    ...Object.keys(candidateCounts),
  ])) {
    deltas[key] = {
      baseline: baselineCounts[key] ?? 0,
      candidate: candidateCounts[key] ?? 0,
    };
  }
  return deltas;
}

/**
 * Roll a `GenEvalRunResult` into a decision-grade `GenEvalSummary`. Pure — no
 * I/O. `approvalRateDelta` is `candidate - baseline` (positive = the candidate
 * approves more); `reasonDeltas` / `flagDeltas` give per-key
 * `{ baseline, candidate }` counts so a reviewer can see exactly which
 * rejection reasons / flag tags moved (Req 5.1–5.4).
 */
export function computeGenDiff(run: GenEvalRunResult): GenEvalSummary {
  const baselineStats = computeArmStats(run.cells.map((c) => c.baseline));
  const candidateStats = computeArmStats(run.cells.map((c) => c.candidate));

  return {
    runName: run.runName,
    baseline: run.baseline,
    candidate: run.candidate,
    datasetName: run.datasetName,
    startedAt: run.startedAt,
    cellCount: run.cells.length,
    draftsPerCell: run.draftsPerCell,
    costCapped: run.costCapped,
    baselineStats,
    candidateStats,
    approvalRateDelta: candidateStats.approvalRate - baselineStats.approvalRate,
    reasonDeltas: buildDeltas(
      baselineStats.rejectionReasonCounts,
      candidateStats.rejectionReasonCounts,
    ),
    flagDeltas: buildDeltas(
      baselineStats.flagTagCounts,
      candidateStats.flagTagCounts,
    ),
    costUsd: {
      baseline: baselineStats.costUsd,
      candidate: candidateStats.costUsd,
    },
    errors: run.errors,
    perCell: run.cells.map((c) => ({
      cellKey: c.cellKey,
      baseline: computeArmStats([c.baseline]),
      candidate: computeArmStats([c.candidate]),
    })),
  };
}

// ---------------------------------------------------------------------------
// Output — markdown to stdout (no perCell) + JSON file (with perCell).
// ---------------------------------------------------------------------------

const pct = (rate: number): string => `${(rate * 100).toFixed(1)}%`;
const usd = (value: number): string => `$${value.toFixed(4)}`;
const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/**
 * Render a decision-grade markdown summary for stdout. Excludes `perCell`
 * (that lives in the JSON file) — an operator scanning the terminal wants the
 * aggregate, not a per-cell dump. Shows: a header (run name, both sources+sha,
 * dataset, started, cell/draft counts, cost-cap note), an approval-rate /
 * bucket table (baseline | candidate | Δ), rejection-reason and flag-tag delta
 * tables, a cost row, and an errors section (Req 5.5).
 */
export function renderMarkdownSummary(summary: GenEvalSummary): string {
  const b = summary.baselineStats;
  const c = summary.candidateStats;
  const lines: string[] = [];

  lines.push(`# Generation eval run \`${summary.runName}\``);
  lines.push("");
  lines.push(`- **baseline:** ${summary.baseline.source} (sha ${summary.baseline.sha})`);
  lines.push(`- **candidate:** ${summary.candidate.source} (sha ${summary.candidate.sha})`);
  lines.push(`- **dataset:** ${summary.datasetName}`);
  lines.push(`- **started:** ${summary.startedAt}`);
  lines.push(
    `- **cells:** ${summary.cellCount} × ${summary.draftsPerCell} drafts/arm` +
      ` (${b.totalDrafts} baseline + ${c.totalDrafts} candidate drafts)`,
  );
  if (summary.costCapped) {
    lines.push(`- **⚠️ cost cap reached** — partial results (stopped at a cell boundary)`);
  }

  lines.push("");
  lines.push("## Approval rate & buckets");
  lines.push("");
  lines.push("| Metric | Baseline | Candidate | Δ |");
  lines.push("|---|---|---|---|");
  lines.push(
    `| approval rate | ${pct(b.approvalRate)} | ${pct(c.approvalRate)} |` +
      ` ${signed(Number((summary.approvalRateDelta * 100).toFixed(1)))}pp |`,
  );
  lines.push(`| auto-approved | ${b.autoApproved} | ${c.autoApproved} | ${signed(c.autoApproved - b.autoApproved)} |`);
  lines.push(`| flagged | ${b.flagged} | ${c.flagged} | ${signed(c.flagged - b.flagged)} |`);
  lines.push(`| rejected | ${b.rejected} | ${c.rejected} | ${signed(c.rejected - b.rejected)} |`);
  lines.push(`| parser-failure | ${b.parserFailure} | ${c.parserFailure} | ${signed(c.parserFailure - b.parserFailure)} |`);
  lines.push(`| total drafts | ${b.totalDrafts} | ${c.totalDrafts} | ${signed(c.totalDrafts - b.totalDrafts)} |`);

  const deltaTable = (
    title: string,
    deltas: Record<string, { baseline: number; candidate: number }>,
    keyHeader: string,
  ): void => {
    lines.push("");
    lines.push(`## ${title}`);
    lines.push("");
    const keys = Object.keys(deltas).sort();
    if (keys.length === 0) {
      lines.push("_(none)_");
      return;
    }
    lines.push(`| ${keyHeader} | Baseline | Candidate |`);
    lines.push("|---|---|---|");
    for (const key of keys) {
      lines.push(`| ${key} | ${deltas[key].baseline} | ${deltas[key].candidate} |`);
    }
  };

  deltaTable("Rejection reasons", summary.reasonDeltas, "reason");
  deltaTable("Flag tags", summary.flagDeltas, "tag");

  lines.push("");
  lines.push("## Cost");
  lines.push("");
  lines.push("| | Baseline | Candidate |");
  lines.push("|---|---|---|");
  lines.push(`| cost USD | ${usd(summary.costUsd.baseline)} | ${usd(summary.costUsd.candidate)} |`);

  lines.push("");
  lines.push(`## Errors (${summary.errors.length})`);
  lines.push("");
  if (summary.errors.length === 0) {
    lines.push("_(none)_");
  } else {
    for (const e of summary.errors) {
      lines.push(`- \`${e.cellKey}\`: ${e.error}`);
    }
  }

  return lines.join("\n");
}

/**
 * Persist the full summary (including `perCell`) under
 * `./eval-runs/<runName>.json`, reusing `eval-run.ts`'s writer + dir. The cast
 * is safe and contained: `writeSummaryJson` only reads `runName` and
 * JSON-serializes the whole object, and `GenEvalSummary` serializes cleanly —
 * this avoids duplicating the mkdir+write logic without modifying `eval-run.ts`.
 */
export function writeGenSummaryJson(
  summary: GenEvalSummary,
  outDir: string = EVAL_RUNS_DIR,
): string {
  return writeSummaryJson(summary as unknown as EvalRunSummary, outDir);
}

// ---------------------------------------------------------------------------
// CLI argv parser + usage
// ---------------------------------------------------------------------------

/** Default drafts generated per cell per arm; bounded by `GenerationSpec.count`. */
const DEFAULT_DRAFTS_PER_CELL = 5;
const MIN_DRAFTS_PER_CELL = 1;
const MAX_DRAFTS_PER_CELL = 200;

/**
 * Parse `eval-gen-run`'s argv. `--baseline` defaults to `repo` (the committed
 * `GENERATION_SYSTEM_PROMPT_TEMPLATE`, the natural comparison point per Req 1.3);
 * `--candidate` and `--dataset-file` are required — omitting `--dataset-file`
 * throws a usage error rather than running against an empty dataset (Req 3.4).
 * `--drafts-per-cell` defaults to 5 and is bounded to 1..200 to match
 * `GenerationSpec.count`'s valid range (Req 4.1).
 */
export function parseEvalGenArgs(
  argv: string[] = process.argv.slice(2),
): EvalGenArgs {
  const parsed = parseArgs({
    args: argv,
    options: {
      baseline: { type: "string", default: "repo" },
      candidate: { type: "string" },
      "dataset-file": { type: "string" },
      "drafts-per-cell": { type: "string" },
      limit: { type: "string" },
      "run-name": { type: "string" },
      "allow-prod": { type: "boolean", default: false },
      "max-cost-usd": { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    printGenUsage();
    process.exit(0);
  }

  const missing: string[] = [];
  for (const k of ["candidate", "dataset-file"] as const) {
    if (parsed.values[k] === undefined || parsed.values[k] === "") {
      missing.push(`--${k}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `[eval-gen] missing required argument(s): ${missing.join(", ")}`,
    );
  }

  let draftsPerCell = DEFAULT_DRAFTS_PER_CELL;
  const rawDrafts = parsed.values["drafts-per-cell"];
  if (rawDrafts !== undefined && rawDrafts !== "") {
    const n = Number(rawDrafts);
    if (
      !Number.isFinite(n) ||
      !Number.isInteger(n) ||
      n < MIN_DRAFTS_PER_CELL ||
      n > MAX_DRAFTS_PER_CELL
    ) {
      throw new Error(
        `[eval-gen] --drafts-per-cell must be an integer in ` +
          `${MIN_DRAFTS_PER_CELL}..${MAX_DRAFTS_PER_CELL}, got ${rawDrafts}`,
      );
    }
    draftsPerCell = n;
  }

  let limit: number | undefined;
  if (parsed.values.limit !== undefined && parsed.values.limit !== "") {
    const n = Number(parsed.values.limit);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      throw new Error(
        `[eval-gen] --limit must be a positive integer, got ${parsed.values.limit}`,
      );
    }
    limit = n;
  }

  let maxCostUsd: number | undefined;
  const rawMaxCost = parsed.values["max-cost-usd"];
  if (rawMaxCost !== undefined && rawMaxCost !== "") {
    const n = Number(rawMaxCost);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(
        `[eval-gen] --max-cost-usd must be a positive number, got ${rawMaxCost}`,
      );
    }
    maxCostUsd = n;
  }

  return {
    baseline: parsed.values.baseline ?? "repo",
    candidate: parsed.values.candidate!,
    datasetFile: parsed.values["dataset-file"]!,
    draftsPerCell,
    limit,
    runName: parsed.values["run-name"],
    allowProd: parsed.values["allow-prod"] ?? false,
    maxCostUsd,
  };
}

function printGenUsage(): void {
  console.log(
    [
      "Usage: pnpm eval:gen --candidate <source> --dataset-file <path>",
      "                    [--baseline <source>] [--drafts-per-cell <n>]",
      "                    [--limit <n>] [--run-name <name>] [--allow-prod]",
      "                    [--max-cost-usd <n>]",
      "",
      "Compares two generation-prompt sources over a dataset of cells,",
      "reporting approval-rate / rejection-reason / flag-tag deltas. Writes a",
      "markdown summary to stdout and a JSON summary to ./eval-runs/<runName>.json.",
      "",
      "  --candidate <source>     Required. repo | file:<path> | langfuse:<name>@<label>",
      "  --dataset-file <path>    Required. JSON array of cell descriptors.",
      "  --baseline <source>      Default: repo (the committed template fallback).",
      "  --drafts-per-cell <n>    Drafts per cell per arm. Default 5, range 1..200.",
      "  --limit <n>              Cap cells processed (cheap smoke runs).",
      "  --run-name <name>        Optional. Defaults to candidate-<sha8>-<iso>.",
      "  --allow-prod             Required if LANGFUSE_ENV=prod (safety guard).",
      "  --max-cost-usd <n>       Hard cost ceiling; stops at a cell boundary.",
      "  --help                   Show this message.",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// CLI entry — only runs when invoked directly via `tsx scripts/eval-gen-run.ts`
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseEvalGenArgs();
  assertNotProdWithoutAllow(process.env.LANGFUSE_ENV, args.allowProd);

  const lf = getLangfuse();
  if (!lf) {
    console.error(
      "[eval-gen] Langfuse client unavailable — set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in your env",
    );
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "[eval-gen] ANTHROPIC_API_KEY missing — eval-gen spends real Anthropic budget",
    );
    process.exit(1);
  }

  const baseline = await resolveGenerationPromptSource(args.baseline, lf);
  const candidate = await resolveGenerationPromptSource(args.candidate, lf);

  const dataset = loadCellDataset(readFileSync(args.datasetFile, "utf8"));
  const datasetName = path.basename(args.datasetFile);
  const runName = deriveRunName(candidate.sha, args.runName, new Date());

  const result = await runGenEval({
    executor: makeRealArmExecutor(createClaudeClient(apiKey)),
    dataset,
    baseline,
    candidate,
    args,
    runName,
    datasetName,
  });

  const summary = computeGenDiff(result);
  console.log("");
  console.log(renderMarkdownSummary(summary));
  const jsonPath = writeGenSummaryJson(summary);
  console.log("");
  console.log(`[eval-gen] summary written to ${jsonPath}`);

  // Non-zero exit on any per-cell error OR a cost-capped (partial) run so CI
  // and operators treat an incomplete comparison as a failure (Req 6.5).
  if (summary.errors.length > 0 || summary.costCapped) {
    process.exit(1);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error("[eval-gen] unhandled failure:", err);
    process.exit(1);
  });
}
