/**
 * packages/ai — eval-run CLI (Phase 2 Tasks 24 + 25).
 *
 * Runs a candidate prompt against a Langfuse dataset, linking each result
 * trace to a dataset run, collecting per-item outcomes, then computing a
 * quality / cost / latency diff vs. the baseline + writing a JSON summary
 * to `./eval-runs/<runName>.json`.
 *
 *   - Task 24 — candidate resolution, dataset iteration, per-item exec,
 *     `item.link(trace, runName)` plumbing.
 *   - Task 25 — `computeDiff` + markdown table to stdout + JSON file.
 *     Baseline cost / latency stay `null` today; the dataset items
 *     produced by `pnpm eval:export` don't carry the original-trace
 *     usage. Once that lands, this surface absorbs the new fields.
 *
 * Invocation:
 *   tsx scripts/eval-run.ts \
 *     --dataset eval-smoke \
 *     --candidate file:./fixtures/candidate.txt   (or langfuse:<name>@<label>) \
 *     [--run-name <name>] [--allow-prod] [--limit <n>]
 *
 * Production guard (Req 8 AC 4): refuses to run when `LANGFUSE_ENV=prod`
 * unless `--allow-prod` is set, so an operator can't accidentally point
 * an eval at prod traces and rack up real-user-budget cost.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type Anthropic from "@anthropic-ai/sdk";
import type { LangfuseTraceClient } from "langfuse";

import type { EvaluationResult } from "@language-drill/shared";

import {
  createClaudeClient,
  evaluateAnswer,
  estimateCostUsd,
  getLangfuse,
  withLlmTrace,
  type ClaudeUsageBreakdown,
  type EvaluateAnswerInput,
  type LlmTraceContext,
} from "../src/index.js";
import { sha8 } from "../src/prompts-registry.js";

// ---------------------------------------------------------------------------
// CLI argv shape + parser
// ---------------------------------------------------------------------------

export type EvalRunArgs = {
  dataset: string;
  /** Either `file:<path>` or `langfuse:<name>@<label>` (label optional). */
  candidate: string;
  runName?: string;
  allowProd: boolean;
  limit?: number;
};

export function parseEvalRunArgs(
  argv: string[] = process.argv.slice(2),
): EvalRunArgs {
  const parsed = parseArgs({
    args: argv,
    options: {
      dataset: { type: "string" },
      candidate: { type: "string" },
      "run-name": { type: "string" },
      "allow-prod": { type: "boolean", default: false },
      limit: { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    printUsage();
    process.exit(0);
  }

  const missing: string[] = [];
  for (const k of ["dataset", "candidate"] as const) {
    if (parsed.values[k] === undefined || parsed.values[k] === "") {
      missing.push(`--${k}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `[eval-run] missing required argument(s): ${missing.join(", ")}`,
    );
  }

  let limit: number | undefined;
  if (parsed.values.limit !== undefined && parsed.values.limit !== "") {
    const parsedLimit = Number(parsed.values.limit);
    if (
      !Number.isFinite(parsedLimit) ||
      !Number.isInteger(parsedLimit) ||
      parsedLimit <= 0
    ) {
      throw new Error(
        `[eval-run] --limit must be a positive integer, got ${parsed.values.limit}`,
      );
    }
    limit = parsedLimit;
  }

  return {
    dataset: parsed.values.dataset!,
    candidate: parsed.values.candidate!,
    runName: parsed.values["run-name"],
    allowProd: parsed.values["allow-prod"] ?? false,
    limit,
  };
}

function printUsage(): void {
  console.log(
    [
      "Usage: pnpm eval --dataset <name> --candidate <source> [--run-name <name>]",
      "                [--allow-prod] [--limit <n>]",
      "",
      "Runs a candidate prompt against a Langfuse dataset; links each",
      "result trace to a dataset run and prints per-item outcomes.",
      "",
      "  --dataset <name>      Langfuse dataset to iterate.",
      "  --candidate <source>  file:<path> | langfuse:<name>@<label>",
      "  --run-name <name>     Optional. Defaults to candidate-<sha8>-<iso>.",
      "  --allow-prod          Required if LANGFUSE_ENV=prod (safety guard).",
      "  --limit <n>           Cap items processed (useful for fast iteration).",
      "  --help                Show this message.",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Production guard
// ---------------------------------------------------------------------------

/**
 * Refuse to run when `LANGFUSE_ENV=prod` without `--allow-prod`. Eval runs
 * spend real Anthropic budget — operator opt-in is required so a stray
 * shell pointing at the prod env doesn't bill against the user-facing
 * Anthropic key.
 */
export function assertNotProdWithoutAllow(
  env: string | undefined,
  allowProd: boolean,
): void {
  if (env === "prod" && !allowProd) {
    throw new Error(
      "[eval-run] LANGFUSE_ENV=prod requires --allow-prod (refusing to spend prod-tagged traces)",
    );
  }
}

// ---------------------------------------------------------------------------
// Candidate resolution — file: or langfuse:<name>@<label>
// ---------------------------------------------------------------------------

export type ResolvedCandidate = {
  /** The system prompt body to feed `evaluateAnswer` as systemPromptOverride. */
  text: string;
  /** Raw argv value — round-tripped into run metadata so dashboards can pivot. */
  source: string;
};

/**
 * Narrow port for the candidate fetch path so tests can inject a stub
 * `getPrompt`. The CLI passes the real Langfuse client.
 */
export type LangfusePromptFetcher = {
  getPrompt: (
    name: string,
    version?: number,
    options?: { label?: string },
  ) => Promise<{ prompt: string }>;
};

/**
 * Resolve a `--candidate` argument to its concrete prompt body.
 *
 *   - `file:<path>` → `readFileSync(path, "utf8")`
 *   - `langfuse:<name>@<label>` → `getPrompt(name, undefined, {label})`
 *   - `langfuse:<name>` → defaults to `label = "candidate"` (operator
 *     convention; production should always use a dated candidate label).
 *
 * Throws on any other format so a typo doesn't silently run an eval
 * against an empty prompt.
 */
export async function resolveCandidate(
  candidate: string,
  langfuse: LangfusePromptFetcher,
  options: { readFile?: (path: string) => string } = {},
): Promise<ResolvedCandidate> {
  const readFile = options.readFile ?? ((p) => readFileSync(p, "utf8"));

  if (candidate.startsWith("file:")) {
    const path = candidate.slice("file:".length);
    return { text: readFile(path), source: candidate };
  }
  if (candidate.startsWith("langfuse:")) {
    const spec = candidate.slice("langfuse:".length);
    const at = spec.lastIndexOf("@");
    const name = at >= 0 ? spec.slice(0, at) : spec;
    const label = at >= 0 ? spec.slice(at + 1) : "candidate";
    if (name === "") {
      throw new Error(
        `[eval-run] invalid candidate: empty name in '${candidate}'`,
      );
    }
    const prompt = await langfuse.getPrompt(name, undefined, { label });
    if (typeof prompt.prompt !== "string") {
      throw new Error(
        `[eval-run] candidate '${candidate}' resolved with no prompt body`,
      );
    }
    return { text: prompt.prompt, source: candidate };
  }
  throw new Error(
    `[eval-run] unsupported --candidate '${candidate}' (expected file:<path> or langfuse:<name>@<label>)`,
  );
}

// ---------------------------------------------------------------------------
// Per-item execution — injectable for tests
// ---------------------------------------------------------------------------

export type EvalRunItemExecutorParams = {
  itemId: string;
  evaluateInput: EvaluateAnswerInput;
  candidateText: string;
  promptSha: string;
};

export type EvalRunItemExecutorOutput = {
  actual?: EvaluationResult;
  error?: string;
  latencyMs: number;
  /**
   * The trace captured by the Proxy's `onTraceCreated` hook. Undefined
   * when Langfuse is unset OR when trace creation failed — the orchestrator
   * skips `item.link` in that case rather than fabricating a fake.
   */
  itemTrace?: LangfuseTraceClient;
  /**
   * Per-item USD cost computed from the Anthropic response's `usage`
   * breakdown (Sonnet pricing). Undefined when the call errored before
   * a usage object came back, or when the real executor wasn't used
   * (test stubs may omit it).
   */
  candidateCostUsd?: number;
};

export type EvalRunItemExecutor = (
  params: EvalRunItemExecutorParams,
) => Promise<EvalRunItemExecutorOutput>;

/**
 * Real per-item executor: opens a `withLlmTrace` scope, calls
 * `evaluateAnswer` with the candidate prompt as `systemPromptOverride`,
 * captures the trace via `onTraceCreated`, and records latency + error.
 *
 * `feature: 'evaluate'` + `env: 'dev'` are stamped uniformly across all
 * eval-run traces so the Langfuse dashboard cohort for "eval-runner"
 * traffic is unambiguous (`userId: 'eval-runner'`). The
 * `promptVersion: 'eval-run:<sha8>'` cohort separates eval-runner traces
 * from production `langfuse:<N>` and `fallback:<v>` cohorts so the user
 * dashboards don't get polluted.
 */
export function makeRealItemExecutor(
  client: Anthropic,
): EvalRunItemExecutor {
  return async (params) => {
    const ctx: LlmTraceContext = {
      feature: "evaluate",
      env: "dev",
      promptVersion: `eval-run:${params.promptSha}`,
      requestId: `evalrun:${params.itemId}`,
      userId: "eval-runner",
      language: params.evaluateInput.language,
      cefrLevel: params.evaluateInput.difficulty,
      // `onTraceCreated` runs synchronously inside the Proxy under the
      // same ALS frame — safe to assign to the closure variable.
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      onTraceCreated: (trace) => {
        captured = trace;
      },
    };

    let captured: LangfuseTraceClient | undefined;
    let actual: EvaluationResult | undefined;
    let error: string | undefined;
    const usageSink: { current: ClaudeUsageBreakdown | undefined } = {
      current: undefined,
    };
    const wrappedClient = wrapForUsageCapture(client, usageSink);
    const start = performance.now();

    try {
      await withLlmTrace(ctx, async () => {
        actual = await evaluateAnswer(wrappedClient, {
          ...params.evaluateInput,
          systemPromptOverride: params.candidateText,
        });
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const latencyMs = performance.now() - start;
    const candidateCostUsd =
      usageSink.current !== undefined
        ? estimateCostUsd(usageSink.current)
        : undefined;
    return {
      actual,
      error,
      latencyMs,
      itemTrace: captured,
      candidateCostUsd,
    };
  };
}

/**
 * Shape of the Anthropic SDK's `Message.usage`. Repeated locally (rather
 * than imported from `@anthropic-ai/sdk`) so this file can read the field
 * defensively without a hard dep on the SDK's type internals.
 */
type AnthropicResponseUsage = {
  input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens?: number | null;
};

/**
 * Proxy-wraps an Anthropic client so every `messages.create` response's
 * `usage` block is captured into the supplied sink. Used by
 * `makeRealItemExecutor` to compute per-item candidate cost without
 * threading usage through `evaluateAnswer`'s return shape.
 *
 * Only `messages.create` is intercepted — every other field forwards
 * through `Reflect.get`. Streaming responses (`messages.stream`) skip
 * the wrapper because evaluate uses non-stream tool-use only.
 */
function wrapForUsageCapture(
  client: Anthropic,
  sink: { current: ClaudeUsageBreakdown | undefined },
): Anthropic {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== "messages") {
        return Reflect.get(target, prop, receiver);
      }
      const messages = Reflect.get(target, prop, receiver) as Anthropic["messages"];
      return new Proxy(messages, {
        get(t2, p2, r2) {
          if (p2 !== "create") {
            return Reflect.get(t2, p2, r2);
          }
          const originalCreate = Reflect.get(t2, p2, r2) as (
            ...args: unknown[]
          ) => Promise<unknown>;
          return async function wrappedCreate(...args: unknown[]) {
            const response = await originalCreate.apply(messages, args);
            if (
              response !== null &&
              typeof response === "object" &&
              "usage" in response
            ) {
              const u = (response as { usage: AnthropicResponseUsage | null }).usage;
              if (u) {
                sink.current = {
                  inputTokens: u.input_tokens ?? 0,
                  cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
                  cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
                  outputTokens: u.output_tokens ?? 0,
                };
              }
            }
            return response;
          };
        },
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Orchestrator — runEvalRun
// ---------------------------------------------------------------------------

/**
 * Narrow port for the dataset-iteration surface. Tests inject a stub
 * dataset whose `items[].link` is a `vi.fn()`; the CLI passes the real
 * Langfuse client.
 */
export type LangfuseDatasetIterator = LangfusePromptFetcher & {
  getDataset: (name: string) => Promise<{
    name: string;
    items: ReadonlyArray<EvalRunDatasetItem>;
  }>;
};

/**
 * Minimal shape of a dataset item used by the eval runner. The real SDK
 * `DatasetItem` extends this with many more fields; we only consume what's
 * needed so the port type stays small and test fixtures stay readable.
 */
export type EvalRunDatasetItem = {
  id: string;
  input: unknown;
  expectedOutput: unknown;
  metadata?: unknown;
  link: (
    obj: unknown,
    runName: string,
    runArgs?: { description?: string; metadata?: unknown },
  ) => Promise<{ id: string }>;
};

/** Per-item result accumulated during a run. */
export type ItemResult = {
  itemId: string;
  submissionId?: string;
  input: EvaluateAnswerInput;
  expected: unknown;
  actual?: EvaluationResult;
  error?: string;
  latencyMs: number;
  candidateTraceId?: string;
  /** USD cost of the candidate Claude call (computed from response.usage). */
  candidateCostUsd?: number;
  /**
   * USD cost of the baseline call captured at `eval-export` time. Today
   * this is always `null` — the exporter doesn't yet copy the source
   * trace's usage into `expectedOutput`. Stamped null per item so the
   * downstream diff knows the field is intentionally unset rather than
   * forgotten.
   */
  baselineCostUsd?: number | null;
};

export type EvalRunOrchestrationResult = {
  runName: string;
  promptSha: string;
  candidateSource: string;
  datasetName: string;
  startedAt: string;
  items: ItemResult[];
};

/** Pull `submissionId` from item metadata if present (string-typed). */
function pickSubmissionId(metadata: unknown): string | undefined {
  if (metadata === null || typeof metadata !== "object") return undefined;
  const id = (metadata as { submissionId?: unknown }).submissionId;
  return typeof id === "string" ? id : undefined;
}

/**
 * Validate that an item's input has the shape `evaluateAnswer` expects.
 * Datasets created by `pnpm eval:export` always satisfy this — but a
 * hand-curated dataset might not, and a typed assert here is friendlier
 * than a runtime crash inside `evaluateAnswer`.
 */
function isEvaluateAnswerInput(value: unknown): value is EvaluateAnswerInput {
  if (value === null || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    "exercise" in r &&
    typeof r.userAnswer === "string" &&
    typeof r.language === "string" &&
    typeof r.difficulty === "string"
  );
}

export async function runEvalRun(opts: {
  langfuse: LangfuseDatasetIterator;
  executor: EvalRunItemExecutor;
  args: EvalRunArgs;
  candidateText: string;
  candidateSource: string;
  promptSha: string;
  runName: string;
  now?: () => Date;
  log?: (...args: unknown[]) => void;
}): Promise<EvalRunOrchestrationResult> {
  const {
    langfuse,
    executor,
    args,
    candidateText,
    candidateSource,
    promptSha,
    runName,
    now = () => new Date(),
    log = (...a: unknown[]) => console.log(...a),
  } = opts;

  const startedAt = now().toISOString();
  const dataset = await langfuse.getDataset(args.dataset);
  const items =
    args.limit !== undefined ? dataset.items.slice(0, args.limit) : dataset.items;

  log(
    `[eval-run] dataset=${args.dataset} items=${items.length} runName=${runName} promptSha=${promptSha}`,
  );

  const results: ItemResult[] = [];

  for (const item of items) {
    if (!isEvaluateAnswerInput(item.input)) {
      log(
        `[eval-run] item ${item.id} has malformed input; recording error and skipping evaluator`,
      );
      results.push({
        itemId: item.id,
        submissionId: pickSubmissionId(item.metadata),
        // We type the field as `EvaluateAnswerInput` for downstream callers
        // but a malformed dataset can land here; preserve the raw value via
        // a cast so the JSON output still reflects what was on disk.
        input: item.input as EvaluateAnswerInput,
        expected: item.expectedOutput,
        error: "item.input does not match EvaluateAnswerInput shape",
        latencyMs: 0,
      });
      continue;
    }

    const result = await executor({
      itemId: item.id,
      evaluateInput: item.input,
      candidateText,
      promptSha,
    });

    if (result.itemTrace) {
      try {
        await item.link(result.itemTrace, runName, {
          metadata: { promptSha, candidateSource },
        });
      } catch (linkErr) {
        // Per design Scenario 4: link failures are SOFT — we keep the
        // per-item result in the summary so the operator still gets the
        // eval data; only the Langfuse dataset-run UI loses the link
        // for this row.
        log(
          `[eval-run] item.link failed for ${item.id}; eval data preserved in summary`,
          linkErr,
        );
      }
    }

    results.push({
      itemId: item.id,
      submissionId: pickSubmissionId(item.metadata),
      input: item.input,
      expected: item.expectedOutput,
      actual: result.actual,
      error: result.error,
      latencyMs: result.latencyMs,
      candidateTraceId: pickTraceId(result.itemTrace),
      candidateCostUsd: result.candidateCostUsd,
      // Baseline cost isn't captured today (the dataset-exporter doesn't
      // copy the source trace's usage). Stamp `null` per row so the diff
      // layer knows it's intentionally unset, not forgotten.
      baselineCostUsd: null,
    });
  }

  log(
    `[eval-run] complete dataset=${args.dataset} items=${results.length} errors=${results.filter((r) => r.error !== undefined).length}`,
  );

  return {
    runName,
    promptSha,
    candidateSource,
    datasetName: args.dataset,
    startedAt,
    items: results,
  };
}

/**
 * Pull `id` off the captured trace if the SDK exposes one. Some SDK
 * versions expose `id` directly, others nest it; we read defensively
 * to avoid a typed-cast crash on a future shape change.
 */
function pickTraceId(trace: LangfuseTraceClient | undefined): string | undefined {
  if (trace === undefined) return undefined;
  const id = (trace as unknown as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

// ---------------------------------------------------------------------------
// Diff layer — quality / cost / latency vs. baseline (Task 25)
// ---------------------------------------------------------------------------

/**
 * Result of comparing per-item candidate vs. baseline scalars. `avgDelta`
 * is the mean of `(candidate - baseline)`; `p95AbsDelta` is the 95th
 * percentile of `|delta|`; `signFlips` (when the metric has a meaningful
 * 0/1 threshold like 0.5 for `score`) counts items that crossed the
 * pass/fail boundary.
 */
export type DeltaStats = {
  avgDelta: number;
  p95AbsDelta: number;
  signFlips?: number;
};

/** CEFR → integer 0..5 so distance is `Math.abs(idx_a - idx_b)`. */
const CEFR_LEVEL_INDEX: Readonly<Record<string, number>> = {
  A1: 0,
  A2: 1,
  B1: 2,
  B2: 3,
  C1: 4,
  C2: 5,
};

export function cefrIndex(level: string): number | undefined {
  return CEFR_LEVEL_INDEX[level.toUpperCase()];
}

/** p50 (median) of a sample. Empty → 0 (no items, nothing to summarise). */
function percentile50(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** p95 of a sample. Empty → 0. */
function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  // Use ceil-style index so a 20-item sample lands on slot 19 (the max),
  // mirroring how `dd-trace` and many other tools report p95 on tiny
  // samples without floating-point surprises.
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil(0.95 * sorted.length) - 1,
  );
  return sorted[Math.max(idx, 0)];
}

/**
 * Compute `(candidate - baseline)` deltas for a scalar field across all
 * items where both sides are present. Skips items with no `actual` (eval
 * failed) and items whose `expected` doesn't expose the field.
 */
export function deltaStats(
  items: readonly ItemResult[],
  pick: (r: EvaluationResult) => number,
  signFlipThreshold?: number,
): DeltaStats {
  const deltas: number[] = [];
  let signFlips = 0;
  let comparableCount = 0;
  for (const item of items) {
    if (item.actual === undefined) continue;
    const expectedRecord = item.expected as Partial<EvaluationResult> | null;
    if (expectedRecord === null || typeof expectedRecord !== "object") continue;
    let expectedValue: number;
    let actualValue: number;
    try {
      expectedValue = pick(expectedRecord as EvaluationResult);
      actualValue = pick(item.actual);
    } catch {
      continue;
    }
    if (typeof expectedValue !== "number" || !Number.isFinite(expectedValue)) {
      continue;
    }
    if (typeof actualValue !== "number" || !Number.isFinite(actualValue)) {
      continue;
    }
    const delta = actualValue - expectedValue;
    deltas.push(delta);
    comparableCount++;
    if (signFlipThreshold !== undefined) {
      const expSide = expectedValue >= signFlipThreshold;
      const actSide = actualValue >= signFlipThreshold;
      if (expSide !== actSide) signFlips++;
    }
  }
  if (comparableCount === 0) {
    return signFlipThreshold !== undefined
      ? { avgDelta: 0, p95AbsDelta: 0, signFlips: 0 }
      : { avgDelta: 0, p95AbsDelta: 0 };
  }
  const avgDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  const p95AbsDelta = percentile95(deltas.map((d) => Math.abs(d)));
  return signFlipThreshold !== undefined
    ? { avgDelta, p95AbsDelta, signFlips }
    : { avgDelta, p95AbsDelta };
}

/** Exact-match agreement rate + average integer-step distance. */
export function cefrStats(items: readonly ItemResult[]): {
  agreementRate: number;
  avgDistance: number;
} {
  let total = 0;
  let matched = 0;
  let distSum = 0;
  let distCount = 0;
  for (const item of items) {
    if (item.actual === undefined) continue;
    const expected = (item.expected as Partial<EvaluationResult> | null)
      ?.estimatedCefrEvidence;
    if (typeof expected !== "string") continue;
    const actual = item.actual.estimatedCefrEvidence;
    if (typeof actual !== "string") continue;
    total++;
    if (actual.toUpperCase() === expected.toUpperCase()) matched++;
    const expIdx = cefrIndex(expected);
    const actIdx = cefrIndex(actual);
    if (expIdx !== undefined && actIdx !== undefined) {
      distSum += Math.abs(expIdx - actIdx);
      distCount++;
    }
  }
  return {
    agreementRate: total === 0 ? 0 : matched / total,
    avgDistance: distCount === 0 ? 0 : distSum / distCount,
  };
}

/**
 * Full eval-run summary — `EvalRunSummary` per design Model 3. Written
 * to `./eval-runs/<runName>.json` (with `perItem`) and printed without
 * `perItem` via `renderMarkdownSummary`.
 */
export type EvalRunSummary = {
  runName: string;
  promptSha: string;
  candidateSource: string;
  datasetName: string;
  startedAt: string;
  itemCount: number;
  okCount: number;
  errorCount: number;
  score: DeltaStats;
  grammarAccuracy: DeltaStats;
  taskAchievement: DeltaStats;
  errorCountDelta: DeltaStats;
  cefr: {
    agreementRate: number;
    avgDistance: number;
  };
  costUsd: {
    candidate: number;
    baseline: number | null;
    deltaPct: number | null;
  };
  latencyMs: {
    candidate: { p50: number; p95: number };
    baseline: { p50: number | null; p95: number | null };
  };
  errors: Array<{ submissionId?: string; itemId: string; error: string }>;
  perItem?: ItemResult[];
};

/**
 * Roll the per-item results into a single decision-grade summary. Pure —
 * no I/O. Sign-flip thresholds are 0.5 for the three scalar quality
 * dimensions (the routing rule's boundary); `errorCount` doesn't have a
 * meaningful threshold so its DeltaStats omits `signFlips`.
 */
export function computeDiff(
  run: EvalRunOrchestrationResult,
): EvalRunSummary {
  const items = run.items;
  const okCount = items.filter(
    (r) => r.actual !== undefined && r.error === undefined,
  ).length;
  const errorCount = items.filter((r) => r.error !== undefined).length;

  const candidateLatencies = items.map((r) => r.latencyMs);
  const candidateCosts = items
    .map((r) => r.candidateCostUsd)
    .filter((c): c is number => typeof c === "number");
  const baselineCostValues = items
    .map((r) => r.baselineCostUsd)
    .filter((c): c is number => typeof c === "number");

  const candidateCostSum = candidateCosts.reduce((s, c) => s + c, 0);
  const baselineCostSum =
    baselineCostValues.length === 0
      ? null
      : baselineCostValues.reduce((s, c) => s + c, 0);
  const deltaPct =
    baselineCostSum === null || baselineCostSum === 0
      ? null
      : ((candidateCostSum - baselineCostSum) / baselineCostSum) * 100;

  return {
    runName: run.runName,
    promptSha: run.promptSha,
    candidateSource: run.candidateSource,
    datasetName: run.datasetName,
    startedAt: run.startedAt,
    itemCount: items.length,
    okCount,
    errorCount,
    score: deltaStats(items, (r) => r.score, 0.5),
    grammarAccuracy: deltaStats(items, (r) => r.grammarAccuracy, 0.5),
    taskAchievement: deltaStats(items, (r) => r.taskAchievement, 0.5),
    errorCountDelta: deltaStats(items, (r) => r.errors.length),
    cefr: cefrStats(items),
    costUsd: {
      candidate: Math.round(candidateCostSum * 10000) / 10000,
      baseline:
        baselineCostSum === null
          ? null
          : Math.round(baselineCostSum * 10000) / 10000,
      deltaPct,
    },
    latencyMs: {
      candidate: {
        p50: percentile50(candidateLatencies),
        p95: percentile95(candidateLatencies),
      },
      // Baseline latency would come from the source trace's `latency` field
      // — exporter doesn't pass it through today, so both sides are null.
      baseline: { p50: null, p95: null },
    },
    errors: items
      .filter((r) => r.error !== undefined)
      .map((r) => ({
        submissionId: r.submissionId,
        itemId: r.itemId,
        error: r.error!,
      })),
    perItem: items,
  };
}

// ---------------------------------------------------------------------------
// Markdown summary — printed to stdout (without `perItem`)
// ---------------------------------------------------------------------------

function fmtUsd(value: number | null): string {
  return value === null ? "(not captured)" : `$${value.toFixed(4)}`;
}
function fmtMs(value: number | null): string {
  return value === null ? "(not captured)" : `${value.toFixed(0)}`;
}
function fmtDelta(stats: DeltaStats): string {
  const flips = stats.signFlips !== undefined ? `, signFlips=${stats.signFlips}` : "";
  return `avgΔ=${stats.avgDelta.toFixed(4)}, p95|Δ|=${stats.p95AbsDelta.toFixed(4)}${flips}`;
}

/**
 * Renders a markdown summary suitable for stdout. Excludes `perItem` —
 * that's reserved for the JSON file (operators eyeballing the terminal
 * don't want a per-row dump).
 */
export function renderMarkdownSummary(summary: EvalRunSummary): string {
  const lines: string[] = [];
  lines.push(`# Eval run \`${summary.runName}\``);
  lines.push("");
  lines.push(`- **candidate:** ${summary.candidateSource}`);
  lines.push(`- **promptSha:** ${summary.promptSha}`);
  lines.push(`- **dataset:** ${summary.datasetName}`);
  lines.push(`- **started:** ${summary.startedAt}`);
  lines.push(
    `- **items:** ${summary.itemCount} (ok=${summary.okCount}, errors=${summary.errorCount})`,
  );
  lines.push("");
  lines.push("## Quality / cost / latency vs. baseline");
  lines.push("");
  lines.push("| Metric | Candidate | Baseline | Delta |");
  lines.push("|---|---|---|---|");
  lines.push(
    `| score | — | — | ${fmtDelta(summary.score)} |`,
  );
  lines.push(
    `| grammarAccuracy | — | — | ${fmtDelta(summary.grammarAccuracy)} |`,
  );
  lines.push(
    `| taskAchievement | — | — | ${fmtDelta(summary.taskAchievement)} |`,
  );
  lines.push(`| errorCount | — | — | ${fmtDelta(summary.errorCountDelta)} |`);
  lines.push(
    `| CEFR | agreement=${(summary.cefr.agreementRate * 100).toFixed(1)}% | — | avgDistance=${summary.cefr.avgDistance.toFixed(2)} |`,
  );
  lines.push(
    `| cost USD | ${fmtUsd(summary.costUsd.candidate)} | ${fmtUsd(summary.costUsd.baseline)} | ${summary.costUsd.deltaPct === null ? "—" : `${summary.costUsd.deltaPct.toFixed(1)}%`} |`,
  );
  lines.push(
    `| latency p50 (ms) | ${fmtMs(summary.latencyMs.candidate.p50)} | ${fmtMs(summary.latencyMs.baseline.p50)} | — |`,
  );
  lines.push(
    `| latency p95 (ms) | ${fmtMs(summary.latencyMs.candidate.p95)} | ${fmtMs(summary.latencyMs.baseline.p95)} | — |`,
  );

  if (summary.errors.length > 0) {
    lines.push("");
    lines.push("## Errors");
    lines.push("");
    for (const e of summary.errors) {
      lines.push(`- \`${e.submissionId ?? e.itemId}\`: ${e.error}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// JSON summary — written to `./eval-runs/<runName>.json`
// ---------------------------------------------------------------------------

export const EVAL_RUNS_DIR = "./eval-runs";

/**
 * Persist the full summary (including `perItem`) under
 * `./eval-runs/<runName>.json`. Returns the absolute path written so the
 * CLI can log it. Creates `EVAL_RUNS_DIR` if needed.
 */
export function writeSummaryJson(
  summary: EvalRunSummary,
  outDir: string = EVAL_RUNS_DIR,
): string {
  mkdirSync(outDir, { recursive: true });
  const filename = path.join(outDir, `${summary.runName}.json`);
  writeFileSync(filename, JSON.stringify(summary, null, 2), "utf8");
  return path.resolve(filename);
}

// ---------------------------------------------------------------------------
// runName derivation
// ---------------------------------------------------------------------------

/**
 * `--run-name` is optional. When absent, derive a stable but date-coded
 * name from the candidate's content hash so a re-run with the same
 * candidate text plus a different timestamp produces a distinct
 * dataset-run page.
 */
export function deriveRunName(
  promptSha: string,
  explicit: string | undefined,
  now: Date,
): string {
  if (explicit !== undefined && explicit !== "") return explicit;
  return `candidate-${promptSha}-${now.toISOString()}`;
}

// ---------------------------------------------------------------------------
// CLI entry — only runs when invoked directly via `tsx scripts/eval-run.ts`
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseEvalRunArgs();
  assertNotProdWithoutAllow(process.env.LANGFUSE_ENV, args.allowProd);

  const lf = getLangfuse();
  if (!lf) {
    console.error(
      "[eval-run] Langfuse client unavailable — set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in your env",
    );
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "[eval-run] ANTHROPIC_API_KEY missing — eval-run spends real Anthropic budget",
    );
    process.exit(1);
  }

  const candidate = await resolveCandidate(args.candidate, lf);
  const promptSha = sha8(candidate.text);
  const runName = deriveRunName(promptSha, args.runName, new Date());

  const result = await runEvalRun({
    langfuse: lf,
    executor: makeRealItemExecutor(createClaudeClient(apiKey)),
    args,
    candidateText: candidate.text,
    candidateSource: candidate.source,
    promptSha,
    runName,
  });

  const summary = computeDiff(result);
  console.log("");
  console.log(renderMarkdownSummary(summary));
  const jsonPath = writeSummaryJson(summary);
  console.log("");
  console.log(`[eval-run] summary written to ${jsonPath}`);

  if (summary.errors.length > 0) {
    process.exit(1);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error("[eval-run] unhandled failure:", err);
    process.exit(1);
  });
}
