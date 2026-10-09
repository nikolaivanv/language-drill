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

import {
  CefrLevel,
  ExerciseType,
  Language,
  pickVariantSeeds,
  variantsForType,
} from "@language-drill/shared";
import type {
  CurriculumCefrLevel,
  GrammarPoint,
  LearningLanguage,
} from "@language-drill/shared";
import {
  buildCellKey,
  buildCellSeedWords,
  createDb,
  fetchPriorStems,
  getGrammarPoint,
  requireEnv,
  routeValidationResult,
  type Cell,
  type Db,
} from "@language-drill/db";

import {
  GENERATION_SYSTEM_PROMPT_TEMPLATE,
  HISTORY_STEM_TYPES,
  ZERO_USAGE,
  addUsage,
  applyTemplate,
  createClaudeClient,
  GENERATION_MODEL,
  GENERATION_TOOL_BY_TYPE,
  VALIDATION_MODEL,
  estimateCostUsd,
  estimateCostUsdFor,
  generateBatch,
  getLangfuse,
  historyStem,
  validateDraft,
  type ClaudeUsageBreakdown,
  type Effort,
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
  parseEffort,
  requestModeFor,
  writeSummaryJson,
  type EvalRunSummary,
  type LangfusePromptFetcher,
} from "./eval-run.js";
import {
  cellReuse,
  foldReuse,
  hotTokens,
  measuredPart,
  reuseVerdict,
  type HotToken,
  type ReuseFold,
  type ReuseVerdict,
} from "./pool-reuse-metrics.js";

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
 * One classified draft. `reasons` are the canonical `GenerationReasonCode`
 * strings from `routeValidationResult` (the bounded `code`, not the free-form
 * `detail`); a malformed draft carries `["parser-failure"]`. `variantId` is
 * the construction-variant id this draft was seeded with (from
 * `seedWordsForArm`, or, under `--pool-history`, from `explicitSeeds` filtered
 * to the point's variant ids) — `undefined` for an unseeded arm/draft (baseline, or a
 * point without `constructionVariants`), and for parser-failure outcomes
 * (the seed never reaches a validated draft).
 */
export type DraftOutcome = {
  bucket: DraftBucket;
  reasons: string[];
  variantId?: string;
  /** `historyStem` of the draft (cloze/translation/SC); read by the --pool-history reuse metrics. Absent for parser failures and drafts with no stem. */
  stem?: string;
  /** The draft's `contentJson` as generated — kept so a `--pool-history` run can be read draft by draft (no generation trace exists elsewhere). */
  content?: unknown;
  /** Validator reasons as `code: detail` (or bare `code`) — the free-form text `reasons` deliberately drops. */
  details?: string[];
};

/** One draft as recorded in `poolReuse.perCell[].drafts` (JSON only, never rendered). */
export type PoolDraftRecord = Pick<DraftOutcome, "bucket" | "reasons" | "details" | "content">;

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
  /**
   * USD cost of this arm run, priced per model (generator + validator).
   * Absent → `estimateCostUsd(usage)` (Sonnet-4.6 list price).
   */
  costUsd?: number;
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
  /** Realized draft count per construction-variant id (Task 7), across every
   *  bucket — an arm without seeding (or a point without variants) is `{}`. */
  variantCounts: Record<string, number>;
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
  /** Per-construction-variant realized-draft counts (Task 7), keyed the same
   *  way as `reasonDeltas`/`flagDeltas`. Empty when neither arm seeded. */
  variantDeltas: Record<string, { baseline: number; candidate: number }>;
  costUsd: { baseline: number; candidate: number };
  /** `shapeToolRequest(...).mode` per arm's generator (set by the CLI). */
  requestMode?: { baseline: string; candidate: string };
  errors: Array<{ cellKey: string; error: string }>;
  perCell?: Array<{ cellKey: string; baseline: ArmStats; candidate: ArmStats }>;
  /** `--pool-history` runs only: lexical reuse vs. each cell's pool + the spec's decision rule. */
  poolReuse?: {
    baseline: ReuseFold;
    candidate: ReuseFold;
    verdict: ReuseVerdict;
    perCell: Array<{
      cellKey: string;
      hot: HotToken[];
      baseline: ReuseFold;
      candidate: ReuseFold;
      /** Every draft of both arms, for reading the run draft by draft. */
      drafts: { baseline: PoolDraftRecord[]; candidate: PoolDraftRecord[] };
    }>;
  };
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
  /** `--pool-history`: candidate sees the cell's approved stems; both arms get prod's seeds. */
  poolHistory?: boolean;
  /** Generator model for the candidate arm only (baseline keeps production). */
  candidateModel?: string;
  /** Generator effort for the candidate arm only. */
  candidateEffort?: Effort;
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

/**
 * Per-ordinal construction-variant seeds for one eval arm (Task 7). The
 * BASELINE arm passes `seedConstructionVariants: false` to reproduce today's
 * real unseeded behaviour; the CANDIDATE arm passes `true`. Without that
 * asymmetry both arms would render the identical prompt and the A/B would
 * report a zero delta by construction (ruling, 2026-08-08) — the whole point
 * of this eval is to measure the effect of seeding, so one arm must stay
 * unseeded as the control.
 *
 * The eval has no live pool, so `coverage` is always empty and
 * `pickVariantSeeds` reduces to a share-weighted round robin over the point's
 * declared variants.
 */
export function seedWordsForArm(
  grammarPoint: GrammarPoint,
  exerciseType: ExerciseType,
  draftsPerCell: number,
  seedConstructionVariants: boolean,
): string[] | undefined {
  if (!seedConstructionVariants) return undefined;
  // Scoped to the arm's exercise type, exactly as `buildSeedWords` scopes the
  // production seeder. An A/B that requested a variant production can never
  // request would measure approval on drafts the real pipeline never generates.
  const variants = variantsForType(grammarPoint, exerciseType);
  if (variants.length === 0) return undefined;
  return pickVariantSeeds({
    variants,
    coverage: new Map(),
    count: draftsPerCell,
  });
}

// ---------------------------------------------------------------------------
// Arm executor — generate N drafts under one prompt, validate + classify each.
// ---------------------------------------------------------------------------

/** Everything one arm (baseline or candidate) needs to run a single cell. */
export type GenCellArmExecutorParams = {
  cell: CellDescriptor;
  grammarPoint: GrammarPoint;
  /**
   * Whether this arm should seed the point's declared construction variants
   * (Task 7). `false` for the baseline arm (today's real unseeded
   * behaviour), `true` for the candidate arm — see `seedWordsForArm`.
   */
  seedConstructionVariants: boolean;
  /**
   * `--pool-history` only: the per-ordinal seeds BOTH arms share (prod's
   * `buildCellSeedWords`). When set it replaces `seedWordsForArm`, removing the
   * baseline-unseeded/candidate-seeded asymmetry so the history section is the
   * only difference between arms. The wrapper distinguishes "explicitly
   * unseeded" (`{ seedWords: undefined }`) from "not in pool mode" (absent).
   */
  explicitSeeds?: { seedWords: readonly (string | null)[] | undefined };
  /**
   * The system prompt body already rendered for this cell + arm — passed
   * through to `GenerationSpec.systemPromptOverride` so the resolved prompt
   * source drives generation without a Langfuse fetch.
   *
   * `undefined` ONLY for dictation cells: `eval:gen`'s prompt sources are
   * cloze-shaped (the `repo` source is the cloze `GENERATION_SYSTEM_PROMPT_TEMPLATE`),
   * so injecting one would make `generateOneDraft` use the cloze template
   * verbatim and bypass the dictation builder. Leaving it unset lets
   * `generateOneDraft` call `buildDictationGenerationSystemPrompt` (the repo
   * dictation prompt). See the dictation note on `runGenEval` for the A/B
   * follow-up.
   */
  systemPromptOverride: string | undefined;
  draftsPerCell: number;
  batchSeed: string;
  /** Generator model override (candidate arm only). Validation is unaffected. */
  generatorModel?: string;
  /** Generator effort override (candidate arm only). */
  generatorEffort?: Effort;
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
    seedConstructionVariants,
    explicitSeeds,
    systemPromptOverride,
    draftsPerCell,
    batchSeed,
    generatorModel,
    generatorEffort,
    signal,
  }: GenCellArmExecutorParams): Promise<ArmResult> => {
    const seedWords = explicitSeeds
      ? explicitSeeds.seedWords
      : seedWordsForArm(
          grammarPoint,
          cell.exerciseType,
          draftsPerCell,
          seedConstructionVariants,
        );
    // Explicit (prod) seeds mix frequency lemmas with variant ids; only the
    // latter belong in `variantCounts`.
    const variantIds = new Set(
      variantsForType(grammarPoint, cell.exerciseType).map((v) => v.id),
    );
    const variantFor = (o: number): string | undefined => {
      const seed = seedWords?.[o];
      return seed != null && variantIds.has(seed) ? seed : undefined;
    };
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
      seedWords,
      modelOverride: generatorModel,
      effort: generatorEffort,
    };

    const batch = await generateBatch(client, spec, signal);

    // Seed usage with the generation total (already folds malformed-draft
    // tokens), then add each validation call's usage.
    const genUsage: ClaudeUsageBreakdown = batch.tokenUsage;
    let valUsage: ClaudeUsageBreakdown = ZERO_USAGE;
    const outcomes: DraftOutcome[] = [];

    // `batch.drafts` is ordinal-COMPACTED, not ordinal-indexed: `generateBatch`
    // (generate.ts) walks ordinal 0..count-1 and pushes successes into
    // `drafts` (in ascending ordinal order) while routing failures to the
    // separate `malformedDrafts` array — so `drafts[i]`'s true ordinal equals
    // `i` only when no malformed draft precedes it. `ExerciseDraft` carries no
    // ordinal of its own, so we reconstruct the true ordinal by walking
    // forward and skipping every ordinal known to be malformed. Getting this
    // wrong silently mislabels `variantId` (e.g. a draft generated under
    // variant B's directive gets tagged variant A) without any crash or test
    // failure — exactly the number Task 12 spends real money reading.
    const malformedOrdinals = new Set(
      batch.malformedDrafts.map((m) => m.ordinal),
    );
    let ordinal = 0;

    for (const draft of batch.drafts) {
      while (malformedOrdinals.has(ordinal)) ordinal++;
      const { result, tokenUsage } = await validateDraft(
        client,
        draft,
        spec,
        signal,
      );
      valUsage = addUsage(valUsage, tokenUsage);
      const { reviewStatus, flaggedReasons } = routeValidationResult(result);
      const stem = historyStem(draft.contentJson);
      outcomes.push({
        bucket: bucketForReviewStatus(reviewStatus),
        // Key the distribution on the canonical `code` only — never the
        // free-form `detail` — so reason/flag buckets stay bounded-cardinality
        // (the whole point of the GenerationReason reason-codes refactor).
        reasons: flaggedReasons.map((r) => r.code),
        // The variant this draft was seeded with, if any (undefined for an
        // unseeded arm/draft) — keyed on the true ordinal, not the compacted
        // array index.
        variantId: variantFor(ordinal),
        ...(stem !== null ? { stem } : {}),
        content: draft.contentJson,
        details: flaggedReasons.map((r) => (r.detail ? `${r.code}: ${r.detail}` : r.code)),
      });
      ordinal++;
    }

    // Each malformed draft is a distinct parser-failure outcome (Req 4.4).
    // Stamped with its own variantId (from its true `ordinal`, which
    // `MalformedDraft` does carry) so a variant whose every draft fails to
    // parse still shows up in `variantCounts` — distinct from a variant that
    // was never seeded at all, which is the whole point of measuring this.
    for (const malformed of batch.malformedDrafts) {
      outcomes.push({
        bucket: "parser-failure",
        reasons: ["parser-failure"],
        variantId: variantFor(malformed.ordinal),
      });
    }

    // Generator and validator are priced separately: the generator may be an
    // override model, the validator is always the production one.
    const costUsd =
      estimateCostUsdFor(generatorModel ?? GENERATION_MODEL, genUsage) +
      estimateCostUsdFor(VALIDATION_MODEL, valUsage);
    return { outcomes, usage: addUsage(genUsage, valUsage), costUsd };
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
  /** --pool-history only: the cell's approved stems fed to the candidate. */
  poolStems?: readonly string[];
};

/** What `--pool-history` loads per cell from the database. */
export type PoolContext = {
  stems: readonly string[];
  seedWords: readonly (string | null)[] | undefined;
};

/** Port so tests can stub the database. See `makeDbPoolContextLoader`. */
export type PoolContextLoader = (
  resolved: ResolvedCell,
  draftsPerCell: number,
  batchSeed: string,
) => Promise<PoolContext>;

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
  poolContextLoader?: PoolContextLoader;
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
    poolContextLoader,
  } = opts;

  if (args.poolHistory && !poolContextLoader) {
    throw new Error(
      "[eval-gen] --pool-history requires a pool context loader (DATABASE_URL)",
    );
  }

  const startedAt = now().toISOString();
  const entries =
    args.limit !== undefined ? dataset.slice(0, args.limit) : dataset;

  log(
    `[eval-gen] dataset=${datasetName} cells=${entries.length} ` +
      `draftsPerCell=${args.draftsPerCell} runName=${runName} ` +
      `baseline=${baseline.sha} candidate=${candidate.sha}`,
  );

  if (args.poolHistory) {
    log(
      "[eval-gen] --pool-history: candidate sees each cell's approved stems; both arms share prod seeds",
    );
  }

  const cells: GenCellRecord[] = [];
  const errors: Array<{ cellKey: string; error: string }> = [];
  let costCapped = false;
  let accumulatedCostUsd = 0;

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

      let pool: PoolContext | undefined;
      if (args.poolHistory) {
        if (!HISTORY_STEM_TYPES.has(cell.exerciseType)) {
          throw new Error(
            `--pool-history supports cloze, translation and sentence_construction only (got ${cell.exerciseType})`,
          );
        }
        pool = await poolContextLoader!(resolution, args.draftsPerCell, batchSeed);
      }
      const explicitSeeds = pool ? { seedWords: pool.seedWords } : undefined;

      // Dictation cells flow against the in-repo dictation generation prompt,
      // NOT a rendered cloze `systemPromptOverride`. Both prompt sources
      // (`repo`/`file:`/`langfuse:`) are cloze-shaped: `repo` is the cloze
      // `GENERATION_SYSTEM_PROMPT_TEMPLATE`, and `renderSystemPrompt` →
      // `computeGenerationPromptVars` throws for a dictation cell. So for
      // dictation we skip rendering and leave `systemPromptOverride` unset; the
      // executor's `generateBatch` → `generateOneDraft` then calls
      // `buildDictationGenerationSystemPrompt`. This ONLY gets dictation cells
      // *flowing* through the gate against the repo dictation prompt — it is NOT
      // a true A/B of the dictation generation prompt (both arms would run the
      // same builder). Full A/B is a follow-up: it needs a
      // `--surface dictation-generate` switch + dictation-shaped `file:`/
      // `langfuse:` sources.
      const isDictation = cell.exerciseType === ExerciseType.DICTATION;
      if (isDictation) {
        log(
          `[eval-gen] dictation cell ${cellKey}: ignoring prompt sources ` +
            `(both cloze-shaped) — flowing against the repo dictation prompt. ` +
            `A/B of the dictation generation prompt is a follow-up.`,
        );
      }

      // Render both arms up front — a bad template throws here, before spend.
      const baselinePrompt = isDictation
        ? undefined
        : renderSystemPrompt(baseline.templateBody, inputs);
      const candidatePrompt = isDictation
        ? undefined
        : renderSystemPrompt(
            candidate.templateBody,
            pool ? { ...inputs, priorPoolSurfaces: pool.stems } : inputs,
          );

      const baselineResult = await executor({
        cell,
        grammarPoint,
        // Baseline stays unseeded — it must reproduce today's real behaviour
        // so the candidate's seeding is the only variable under test. Under
        // `--pool-history` both arms instead share `explicitSeeds`.
        seedConstructionVariants: false,
        explicitSeeds,
        systemPromptOverride: baselinePrompt,
        draftsPerCell: args.draftsPerCell,
        batchSeed,
        signal,
      });
      const candidateResult = await executor({
        cell,
        grammarPoint,
        // Candidate seeds the point's declared construction variants —
        // the change this eval exists to measure (Task 7). Under
        // `--pool-history`, `explicitSeeds` overrides this for both arms.
        seedConstructionVariants: true,
        explicitSeeds,
        systemPromptOverride: candidatePrompt,
        draftsPerCell: args.draftsPerCell,
        batchSeed,
        generatorModel: args.candidateModel,
        generatorEffort: args.candidateEffort,
        signal,
      });

      cells.push({
        cellKey,
        baseline: baselineResult,
        candidate: candidateResult,
        ...(pool ? { poolStems: pool.stems } : {}),
      });
      accumulatedCostUsd += armCostUsd(baselineResult) + armCostUsd(candidateResult);
    } catch (e) {
      // Both-arm failure for this cell: record and continue. Partial usage from
      // a half-run cell is intentionally not accrued (the cell is excluded from
      // the comparison entirely).
      errors.push({ cellKey, error: (e as Error).message });
    }

    if (
      args.maxCostUsd !== undefined &&
      accumulatedCostUsd >= args.maxCostUsd
    ) {
      costCapped = true;
      log(
        `[eval-gen] cost cap hit (${accumulatedCostUsd} >= ${args.maxCostUsd} USD); ` +
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
 * flag distribution (Req 5.2, 5.3). `variantCounts` (Task 7) tallies every
 * outcome's `variantId` regardless of bucket, so a flagged/rejected draft
 * still counts toward its variant's realized share.
 *
 * Exported (not just used internally by `computeGenDiff`) so tests can assert
 * the fold directly against hand-built `ArmResult`s.
 */
/** An arm run's cost: its own per-model `costUsd`, else the Sonnet-4.6 estimate. */
function armCostUsd(r: ArmResult): number {
  return r.costUsd ?? estimateCostUsd(r.usage);
}

export function computeArmStats(results: ArmResult[]): ArmStats {
  let totalDrafts = 0;
  let autoApproved = 0;
  let flagged = 0;
  let rejected = 0;
  let parserFailure = 0;
  const rejectionReasonCounts: Record<string, number> = {};
  const flagTagCounts: Record<string, number> = {};
  const variantCounts: Record<string, number> = {};
  let costUsd = 0;

  const bump = (counts: Record<string, number>, reasons: string[]): void => {
    for (const reason of reasons) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
  };

  for (const r of results) {
    costUsd += armCostUsd(r);
    for (const outcome of r.outcomes) {
      totalDrafts++;
      if (outcome.variantId) {
        variantCounts[outcome.variantId] =
          (variantCounts[outcome.variantId] ?? 0) + 1;
      }
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
    variantCounts,
    costUsd,
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

  // `measuredPart` drops an SC stem's English task prompt (see its doc).
  const stemsOf = (arm: ArmResult): string[] =>
    arm.outcomes.flatMap((o) => (o.stem !== undefined ? [measuredPart(o.stem)] : []));
  const recordsOf = (arm: ArmResult): PoolDraftRecord[] =>
    arm.outcomes.map(({ bucket, reasons, details, content }) => ({ bucket, reasons, details, content }));
  const pooled = run.cells.filter((c) => c.poolStems !== undefined);
  const approvalRateDelta = candidateStats.approvalRate - baselineStats.approvalRate;
  let poolReuse: GenEvalSummary["poolReuse"];
  if (pooled.length > 0) {
    const per = pooled.map((c) => {
      const pool = c.poolStems!.map(measuredPart);
      return {
        cellKey: c.cellKey,
        hot: hotTokens(pool),
        baseline: cellReuse(stemsOf(c.baseline), pool),
        candidate: cellReuse(stemsOf(c.candidate), pool),
        drafts: { baseline: recordsOf(c.baseline), candidate: recordsOf(c.candidate) },
      };
    });
    const baselineFold = foldReuse(per.map((p) => p.baseline));
    const candidateFold = foldReuse(per.map((p) => p.candidate));
    poolReuse = {
      baseline: baselineFold,
      candidate: candidateFold,
      verdict: reuseVerdict(baselineFold, candidateFold, approvalRateDelta),
      perCell: per.map((p) => ({
        cellKey: p.cellKey,
        hot: p.hot,
        baseline: foldReuse([p.baseline]),
        candidate: foldReuse([p.candidate]),
        drafts: p.drafts,
      })),
    };
  }

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
    approvalRateDelta,
    reasonDeltas: buildDeltas(
      baselineStats.rejectionReasonCounts,
      candidateStats.rejectionReasonCounts,
    ),
    flagDeltas: buildDeltas(
      baselineStats.flagTagCounts,
      candidateStats.flagTagCounts,
    ),
    variantDeltas: buildDeltas(
      baselineStats.variantCounts,
      candidateStats.variantCounts,
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
    ...(poolReuse ? { poolReuse } : {}),
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

  // Construction-variant spread (Task 7) — placed right after the
  // approval-rate/bucket table so a reviewer can see whether seeding actually
  // diversified the pool without opening the JSON.
  deltaTable("Construction variants", summary.variantDeltas, "variant");

  if (summary.poolReuse) {
    const pr = summary.poolReuse;
    lines.push("");
    lines.push("## Pool reuse (--pool-history)");
    lines.push("");
    lines.push("| Metric | Baseline | Candidate |");
    lines.push("|---|---|---|");
    lines.push(`| hot-token reuse rate | ${pct(pr.baseline.hotReuseRate)} | ${pct(pr.candidate.hotReuseRate)} |`);
    lines.push(`| mean max-Jaccard vs pool | ${pr.baseline.meanMaxJaccard.toFixed(3)} | ${pr.candidate.meanMaxJaccard.toFixed(3)} |`);
    lines.push(`| drafts with a stem | ${pr.baseline.drafts} | ${pr.candidate.drafts} |`);
    lines.push("");
    lines.push(
      `**Verdict:** ${pr.verdict} — ship-ready iff candidate hot-reuse ≤ 0.7 × baseline and approval Δ ≥ −5pp; inconclusive if the baseline shows no hot reuse.`,
    );
    lines.push("");
    lines.push("| cell | hot tokens | reuse (b → c) | max-Jaccard (b → c) |");
    lines.push("|---|---|---|---|");
    for (const c of pr.perCell) {
      const hot =
        c.hot.map((h) => `${h.token} (${Math.round(h.share * 100)}%)`).join(", ") || "_(none)_";
      lines.push(
        `| ${c.cellKey} | ${hot} | ${pct(c.baseline.hotReuseRate)} → ${pct(c.candidate.hotReuseRate)} | ` +
          `${c.baseline.meanMaxJaccard.toFixed(3)} → ${c.candidate.meanMaxJaccard.toFixed(3)} |`,
      );
    }
  }

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
      "pool-history": { type: "boolean", default: false },
      "max-cost-usd": { type: "string" },
      "candidate-model": { type: "string" },
      "candidate-effort": { type: "string" },
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
    poolHistory: parsed.values["pool-history"] ?? false,
    candidateModel:
      parsed.values["candidate-model"] === ""
        ? undefined
        : parsed.values["candidate-model"],
    candidateEffort: parseEffort(parsed.values["candidate-effort"]),
  };
}

function printGenUsage(): void {
  console.log(
    [
      "Usage: pnpm eval:gen --candidate <source> --dataset-file <path>",
      "                    [--baseline <source>] [--drafts-per-cell <n>]",
      "                    [--limit <n>] [--run-name <name>] [--allow-prod]",
      "                    [--max-cost-usd <n>] [--pool-history]",
      "                    [--candidate-model <id>] [--candidate-effort <level>]",
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
      "  --pool-history           Candidate sees each cell's approved stems (reads DATABASE_URL);",
      "                           both arms get prod's seeds. cloze/translation/SC cells only.",
      "  --candidate-model <id>   Generator model for the candidate arm only (baseline keeps",
      "                           production). Validation always uses the production validator.",
      "  --candidate-effort <l>   low|medium|high|xhigh|max. Generator effort, candidate arm only.",
      "  --help                   Show this message.",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// CLI entry — only runs when invoked directly via `tsx scripts/eval-gen-run.ts`
// ---------------------------------------------------------------------------

/** Real `--pool-history` loader: the cell's approved stems + prod's seeds, read-only. */
export function makeDbPoolContextLoader(db: Db): PoolContextLoader {
  return async ({ cell, grammarPoint }, draftsPerCell, batchSeed) => {
    const dbCell: Cell = {
      language: cell.language as LearningLanguage,
      cefrLevel: cell.cefrLevel as CurriculumCefrLevel,
      exerciseType: cell.exerciseType,
      grammarPoint,
      cellKey: buildCellKey(cell),
    };
    const [stems, seedWords] = await Promise.all([
      fetchPriorStems(db, dbCell),
      buildCellSeedWords(db, dbCell, draftsPerCell, batchSeed),
    ]);
    return { stems, seedWords };
  };
}

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

  let poolContextLoader: PoolContextLoader | undefined;
  if (args.poolHistory) {
    const dbUrl = requireEnv("DATABASE_URL");
    // `--allow-prod` guards LANGFUSE_ENV, not the database: say which pool is read.
    console.log(
      `[eval-gen] --pool-history reading the pool (read-only) from ${new URL(dbUrl).host}`,
    );
    poolContextLoader = makeDbPoolContextLoader(createDb(dbUrl));
  }

  // Mode of the generator request per arm (cloze tool as the representative
  // surface tool; mode depends only on model/thinking/effort).
  const requestMode = {
    baseline: requestModeFor(GENERATION_MODEL, GENERATION_TOOL_BY_TYPE.cloze, "off"),
    candidate: requestModeFor(
      args.candidateModel ?? GENERATION_MODEL,
      GENERATION_TOOL_BY_TYPE.cloze,
      "off",
      args.candidateEffort,
    ),
  };
  console.log(
    `[eval-gen] request mode: baseline ${requestMode.baseline}; candidate ${requestMode.candidate}`,
  );

  const result = await runGenEval({
    poolContextLoader,
    executor: makeRealArmExecutor(createClaudeClient(apiKey)),
    dataset,
    baseline,
    candidate,
    args,
    runName,
    datasetName,
  });

  const summary = { ...computeGenDiff(result), requestMode };
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
