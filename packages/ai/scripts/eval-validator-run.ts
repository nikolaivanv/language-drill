/**
 * packages/ai — eval-validator-run CLI (validator replay harness).
 *
 * Measures whether the candidateFillers scratchpad + Sonnet 5 model move
 * (Tasks 1-6 of this branch) actually improved ambiguity detection, using the
 * labelled fixture built in Task 7
 * (`packages/ai/scripts/fixtures/validator-ambiguity-cases.json`).
 *
 * Four arms replay every fixture case so PROMPT and MODEL are never
 * confounded — the branch changed both, and a naive baseline-vs-production
 * comparison couldn't tell which one moved the needle:
 *
 *   baseline     modelOverride: claude-sonnet-4-6, systemPromptOverride: the
 *                pre-Task-4 prompt (captured once into a fixture — see
 *                `PRIOR_TEMPLATE` below)
 *   prompt-only  modelOverride: claude-sonnet-4-6 (new prompt, old model)
 *   model-only   systemPromptOverride: the pre-Task-4 prompt (old prompt, new
 *                model)
 *   both         no overrides — pure production config
 *
 * Both baseline arms pin `modelOverride` explicitly because Task 5 already
 * moved the production default off claude-sonnet-4-6.
 *
 * For each arm, three metrics roll up from `computeArmMetrics` (pure — no
 * network calls, so its tests need no mocking):
 *   - recallOnAmbiguous:    of the fixture's `ambiguous` cases, the fraction
 *                           the arm actually flagged `ambiguous: true`
 *   - falseFlagRateOnClean: of the fixture's `clean` cases, the fraction the
 *                           arm wrongly flagged — the over-flagging control,
 *                           and the merge gate (lower is better)
 *   - selfInconsistentRate: fraction of ALL results whose `flaggedReasons`
 *                           contains SELF_INCONSISTENT_REASON (Task 3's
 *                           report-only self-consistency check)
 *
 * Invocation (see CLAUDE.md — `pnpm <script> -- --flag` throws for every CLI
 * in this package; always `pnpm eval:validator --flag`):
 *   tsx scripts/eval-validator-run.ts
 *     [--limit <n>] [--max-cost-usd <n>] [--dry-run] [--run-name <name>]
 *
 * `--dry-run` prints the arm matrix + case counts and makes ZERO Anthropic
 * calls — always verify a new run shape this way before spending real budget.
 *
 * 31 cases x 4 arms = 124 real Anthropic calls for a full run. Cost is
 * enforced by accumulating actual `tokenUsage` (not case counting) and
 * stopping at a CASE boundary (all 4 arms for a case, or none) once
 * `--max-cost-usd` is reached — partial results are written, never discarded.
 *
 * ## Prompt source: ALWAYS in-repo, NEVER Langfuse (Fix Round 1)
 *
 * Every arm's system prompt is rendered LOCALLY from an in-repo template —
 * `PRIOR_TEMPLATE` (pre-Task-4, read from the committed fixture) or
 * `VALIDATION_SYSTEM_PROMPT_TEMPLATE` (the current in-repo source, post-
 * Task-4) — via `applyTemplate(template, computeValidationPromptVars(spec))`,
 * and the result is ALWAYS passed as `validateDraft`'s `systemPromptOverride`.
 * `validateDraft` only calls `buildValidationSystemPrompt` (which fetches from
 * Langfuse, label `production`) when `systemPromptOverride` is undefined — so
 * a non-empty override deterministically short-circuits that branch, for
 * every arm, regardless of `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` being
 * set in the environment.
 *
 * This is load-bearing, not cosmetic: the `prompt-only`/`both` arms exist to
 * measure the in-repo prompt change (Task 4). Langfuse's `production` label
 * can legitimately lag the repo for days (pushing a new prompt version is a
 * deliberate, separate post-merge step — see CLAUDE.md "Prompt Editing"). If
 * those arms fetched from Langfuse and the fetch SUCCEEDED, they would
 * silently run the OLD prompt body whenever the label hasn't been promoted
 * yet — a false negative on the exact question this harness exists to
 * answer, and one that would only be caught by luck (a timed-out fetch
 * falling back to the in-repo string). Rendering locally makes the harness
 * correct by construction instead of by network luck.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type Anthropic from "@anthropic-ai/sdk";

import { CefrLevel, ExerciseType, Language } from "@language-drill/shared";
import type { ClozeContent } from "@language-drill/shared";
import { getGrammarPoint } from "@language-drill/db";

import {
  ZERO_USAGE,
  addUsage,
  applyTemplate,
  createClaudeClient,
  estimateCostUsd,
  validateDraft,
  VALIDATION_SYSTEM_PROMPT_TEMPLATE,
  type ClaudeUsageBreakdown,
  type ExerciseDraft,
  type GenerationSpec,
  type ValidationResult,
} from "../src/index.js";
// `SELF_INCONSISTENT_REASON` and `computeValidationPromptVars` are not on the
// `@language-drill/ai` barrel (the former's an internal report-only marker,
// Task 3; the latter composes the validator's template vars) — deep-relative
// import, same pattern `eval-gen-run.ts` uses for `computeGenerationPromptVars`
// / `sha8`.
import { SELF_INCONSISTENT_REASON } from "../src/validate.js";
import { computeValidationPromptVars } from "../src/validation-prompts.js";
import { sha8 } from "../src/prompts-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");
const EVAL_RUNS_DIR = "./eval-runs";

// ---------------------------------------------------------------------------
// Fixture case — one row of `validator-ambiguity-cases.json`
// ---------------------------------------------------------------------------

export type ValidatorAmbiguityCase = {
  id: string;
  label: "ambiguous" | "clean";
  provenance: string;
  language: Language;
  cefrLevel: CefrLevel;
  grammarPointKey: string;
  content: ClozeContent;
  why: string;
};

function parseValidatorCase(entry: unknown, index: number): ValidatorAmbiguityCase {
  if (typeof entry !== "object" || entry === null) {
    throw new Error(`[eval-validator] fixture entry ${index} is not an object`);
  }
  const e = entry as Record<string, unknown>;
  const id = typeof e.id === "string" ? e.id : `<entry ${index}>`;

  if (e.label !== "ambiguous" && e.label !== "clean") {
    throw new Error(
      `[eval-validator] case '${id}': label must be "ambiguous" or "clean", got ${JSON.stringify(e.label)}`,
    );
  }
  if (
    typeof e.language !== "string" ||
    typeof e.cefrLevel !== "string" ||
    typeof e.grammarPointKey !== "string" ||
    e.grammarPointKey === ""
  ) {
    throw new Error(
      `[eval-validator] case '${id}': missing/invalid language, cefrLevel, or grammarPointKey`,
    );
  }
  const content = e.content as { type?: unknown } | undefined;
  if (!content || content.type !== "cloze") {
    throw new Error(
      `[eval-validator] case '${id}': content.type must be "cloze" (this is a cloze-only harness), got ${JSON.stringify(content?.type)}`,
    );
  }

  return {
    id,
    label: e.label,
    provenance: typeof e.provenance === "string" ? e.provenance : "",
    // The fixture stores `language` lowercase ("es"/"de"/"tr"); normalize to
    // the uppercase `Language` enum the rest of the pipeline expects (mirrors
    // qa-sample-run.ts's `--language` normalization).
    language: e.language.toUpperCase() as Language,
    cefrLevel: e.cefrLevel as CefrLevel,
    grammarPointKey: e.grammarPointKey,
    content: e.content as ClozeContent,
    why: typeof e.why === "string" ? e.why : "",
  };
}

/**
 * Parse + structurally validate the fixture contents. Throws on a file-level
 * error (not JSON / not an array) or on ANY malformed entry — unlike
 * `eval-gen-run.ts`'s per-cell fault isolation, this fixture is a small,
 * curated, committed file; a malformed row is an authoring bug to fix, not a
 * runtime condition to route around.
 */
export function loadValidatorCases(raw: string): ValidatorAmbiguityCase[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `[eval-validator] fixture is not valid JSON: ${(e as Error).message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("[eval-validator] fixture must be a JSON array of cases");
  }
  return parsed.map((entry, i) => parseValidatorCase(entry, i));
}

// ---------------------------------------------------------------------------
// The four-arm matrix — prompt and model are never confounded
// ---------------------------------------------------------------------------

export type ValidatorArm = {
  name: string;
  modelOverride?: string;
  /**
   * Which in-repo template this arm renders — `"prior"` (pre-Task-4,
   * `PRIOR_TEMPLATE`) or `"current"` (post-Task-4,
   * `VALIDATION_SYSTEM_PROMPT_TEMPLATE`). Every arm has one; there is no
   * "no override" arm and never a Langfuse fetch — see the module docstring's
   * "Prompt source" section.
   */
  promptSource: "prior" | "current";
};

/**
 * The pre-Task-4 validator system-prompt template body, captured once (see
 * the Task 8 brief for the exact `git show 8a661129:...` capture recipe) into
 * a committed fixture. Read from disk, NEVER from git at runtime — after this
 * branch merges, `HEAD~N` stops meaning anything, and the harness must stay
 * reproducible.
 */
export const PRIOR_TEMPLATE = readFileSync(
  path.join(FIXTURES_DIR, "validation-system-prompt-baseline.txt"),
  "utf8",
);

/**
 * The two in-repo template bodies an arm can source from. Both are raw
 * `{{var}}` templates — `renderValidatorSystemPrompt` fills them in per case
 * — and both live entirely in this process; neither is ever fetched.
 */
const PROMPT_TEMPLATES: Record<ValidatorArm["promptSource"], string> = {
  prior: PRIOR_TEMPLATE,
  current: VALIDATION_SYSTEM_PROMPT_TEMPLATE,
};

export const ARMS: ValidatorArm[] = [
  { name: "baseline", modelOverride: "claude-sonnet-4-6", promptSource: "prior" },
  { name: "prompt-only", modelOverride: "claude-sonnet-4-6", promptSource: "current" },
  { name: "model-only", promptSource: "prior" },
  { name: "both", promptSource: "current" },
];

/**
 * Render one of `PROMPT_TEMPLATES` for a specific case's `spec` — the SAME
 * local substitution `buildValidationSystemPrompt` falls back to when
 * Langfuse is unreachable (`applyTemplate` + `computeValidationPromptVars`),
 * just always taken instead of only on fetch failure. Throws if the template
 * references a `{{var}}` the computed map doesn't provide, so a template/var
 * drift fails loud here rather than shipping a half-substituted prompt to
 * Claude.
 */
export function renderValidatorSystemPrompt(
  templateBody: string,
  spec: GenerationSpec,
): string {
  const { text, missingVars } = applyTemplate(
    templateBody,
    computeValidationPromptVars(spec),
  );
  if (missingVars.length > 0) {
    throw new Error(
      `[eval-validator] template references unresolved variables: ${missingVars.join(", ")}`,
    );
  }
  return text;
}

// ---------------------------------------------------------------------------
// computeArmMetrics — PURE. No network calls, no Anthropic client. This is
// the function the merge decision rests on, so it must be trivially testable
// with plain arrays.
// ---------------------------------------------------------------------------

export type ArmMetrics = {
  recallOnAmbiguous: number;
  falseFlagRateOnClean: number;
  selfInconsistentRate: number;
  n: number;
};

/** The minimal shape `computeArmMetrics` needs from a fixture case. */
export type ArmMetricsCaseInput = { label: "ambiguous" | "clean" };
/** The minimal shape `computeArmMetrics` needs from a validation result. */
export type ArmMetricsResultInput = {
  ambiguous: boolean;
  flaggedReasons?: string[];
};

/**
 * Pure roll-up over parallel arrays: `results[i]` is the arm's verdict for
 * `cases[i]`. An empty bucket returns `0`, never `NaN` — a `NaN` would
 * silently poison the arm comparison. `n` is the number of paired
 * (case, result) rows actually scored (not the full fixture size — a
 * cost-capped or per-case-errored run passes a shorter pair).
 */
export function computeArmMetrics(
  cases: ArmMetricsCaseInput[],
  results: ArmMetricsResultInput[],
): ArmMetrics {
  const n = Math.min(cases.length, results.length);

  let ambiguousTotal = 0;
  let ambiguousHit = 0;
  let cleanTotal = 0;
  let cleanFlagged = 0;
  let selfInconsistent = 0;

  for (let i = 0; i < n; i++) {
    const c = cases[i];
    const r = results[i];
    if (c.label === "ambiguous") {
      ambiguousTotal++;
      if (r.ambiguous) ambiguousHit++;
    } else {
      cleanTotal++;
      if (r.ambiguous) cleanFlagged++;
    }
    if (r.flaggedReasons?.includes(SELF_INCONSISTENT_REASON)) {
      selfInconsistent++;
    }
  }

  return {
    recallOnAmbiguous: ambiguousTotal > 0 ? ambiguousHit / ambiguousTotal : 0,
    falseFlagRateOnClean: cleanTotal > 0 ? cleanFlagged / cleanTotal : 0,
    selfInconsistentRate: n > 0 ? selfInconsistent / n : 0,
    n,
  };
}

// ---------------------------------------------------------------------------
// Case -> (GenerationSpec, ExerciseDraft) — the shapes `validateDraft` needs.
// The fixture holds pre-authored `ClozeContent` directly (never generated),
// so these are synthesized rather than produced by `generateBatch`.
// ---------------------------------------------------------------------------

function specForCase(c: ValidatorAmbiguityCase): GenerationSpec {
  const grammarPoint = getGrammarPoint(c.grammarPointKey);
  if (!grammarPoint) {
    throw new Error(
      `[eval-validator] unknown grammarPointKey '${c.grammarPointKey}' (case ${c.id})`,
    );
  }
  return {
    // EN never appears in this fixture (cloze-only, ES/DE/TR); the cast
    // mirrors eval-gen-run.ts's `resolveCell` narrowing.
    language: c.language as Exclude<Language, Language.EN>,
    cefrLevel: c.cefrLevel,
    exerciseType: ExerciseType.CLOZE,
    grammarPoint,
    topicDomain: null,
    count: 1,
    batchSeed: "eval-validator",
  };
}

function draftForCase(c: ValidatorAmbiguityCase): ExerciseDraft {
  return {
    id: c.id,
    contentJson: c.content,
    metadata: {
      grammarPointKey: c.grammarPointKey,
      topicDomain: null,
      modelId: "eval-validator-fixture",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      inBatchDuplicate: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Executor — one (case, arm) pair, one Claude call. Injected so orchestration
// tests never touch the real Anthropic SDK.
// ---------------------------------------------------------------------------

export type ValidatorCaseExecutorParams = {
  case: ValidatorAmbiguityCase;
  arm: ValidatorArm;
  signal?: AbortSignal;
};

export type ValidatorCaseExecutorResult = {
  result: ValidationResult;
  usage: ClaudeUsageBreakdown;
};

export type ValidatorCaseExecutor = (
  params: ValidatorCaseExecutorParams,
) => Promise<ValidatorCaseExecutorResult>;

export function makeRealValidatorExecutor(
  client: Anthropic,
): ValidatorCaseExecutor {
  return async ({ case: c, arm, signal }) => {
    const spec = specForCase(c);
    const draft = draftForCase(c);

    // Render this arm's template LOCALLY, per case (vars depend on the
    // case's language/cefrLevel/grammarPoint) and pass it as
    // `systemPromptOverride` UNCONDITIONALLY. `validateDraft` only reaches
    // `buildValidationSystemPrompt` (and therefore Langfuse) when
    // `systemPromptOverride` is nullish — so this guarantees every arm's
    // prompt is repo-sourced regardless of `LANGFUSE_PUBLIC_KEY`/
    // `LANGFUSE_SECRET_KEY` in the environment. See the module docstring's
    // "Prompt source" section for why this must not be conditional.
    const systemPromptOverride = renderValidatorSystemPrompt(
      PROMPT_TEMPLATES[arm.promptSource],
      spec,
    );
    // Self-documenting guard against a future refactor accidentally making
    // this optional again (e.g. reintroducing an arm with no `promptSource`,
    // or a code path that skips rendering) — a falsy override here would
    // silently fall through to the Langfuse-fetching branch. This should be
    // unreachable; `renderValidatorSystemPrompt` throws before returning an
    // empty string for any real template.
    if (!systemPromptOverride) {
      throw new Error(
        `[eval-validator] BUG: systemPromptOverride resolved empty for arm ` +
          `'${arm.name}' (case ${c.id}) — this would fall through to ` +
          `buildValidationSystemPrompt() and hit Langfuse. Every arm must ` +
          `render a non-empty in-repo template.`,
      );
    }

    const { result, tokenUsage } = await validateDraft(client, draft, spec, signal, {
      modelOverride: arm.modelOverride,
      systemPromptOverride,
    });
    return { result, usage: tokenUsage };
  };
}

// ---------------------------------------------------------------------------
// Orchestrator — loop cases x arms, fault-isolated per (case, arm),
// cost-bounded at a CASE boundary (all arms for a case, or none).
// ---------------------------------------------------------------------------

export type ValidatorCaseRecord = {
  caseId: string;
  label: "ambiguous" | "clean";
  result?: ValidationResult;
  error?: string;
};

export type ValidatorArmRunResult = {
  arm: ValidatorArm;
  records: ValidatorCaseRecord[];
  usage: ClaudeUsageBreakdown;
};

export type ValidatorEvalRunResult = {
  runName: string;
  datasetName: string;
  startedAt: string;
  caseCount: number;
  /** True if the run stopped early at a case boundary on `--max-cost-usd`. */
  costCapped: boolean;
  arms: ValidatorArmRunResult[];
};

/**
 * Drive all four arms over every case with two guarantees:
 *
 *   - **Fault isolation:** a (case, arm) pair whose executor throws is
 *     recorded on that arm as an errored record; the loop continues — one bad
 *     call never aborts the run.
 *   - **Case-boundary cost cap:** before starting a new case, the
 *     accumulated `estimateCostUsd` (across every arm so far) is checked
 *     against `maxCostUsd`; if reached, `costCapped` is set and the loop
 *     stops — so every case that DID run has all 4 arms represented (no
 *     half-compared case), and partial results are always written, never
 *     thrown away.
 *
 * The executor is injected so tests run without live Claude.
 */
export async function runValidatorEval(opts: {
  executor: ValidatorCaseExecutor;
  cases: ValidatorAmbiguityCase[];
  arms: ValidatorArm[];
  runName: string;
  datasetName: string;
  maxCostUsd?: number;
  signal?: AbortSignal;
  now?: () => Date;
  log?: (...args: unknown[]) => void;
}): Promise<ValidatorEvalRunResult> {
  const {
    executor,
    cases,
    arms,
    runName,
    datasetName,
    maxCostUsd,
    signal,
    now = () => new Date(),
    log = (...a: unknown[]) => console.log(...a),
  } = opts;

  const startedAt = now().toISOString();
  log(
    `[eval-validator] dataset=${datasetName} cases=${cases.length} ` +
      `arms=${arms.map((a) => a.name).join(",")} runName=${runName}`,
  );

  const armResults: ValidatorArmRunResult[] = arms.map((arm) => ({
    arm,
    records: [],
    usage: ZERO_USAGE,
  }));

  let accumulatedUsage: ClaudeUsageBreakdown = ZERO_USAGE;
  let costCapped = false;

  for (const c of cases) {
    if (
      maxCostUsd !== undefined &&
      estimateCostUsd(accumulatedUsage) >= maxCostUsd
    ) {
      costCapped = true;
      log(
        `[eval-validator] cost cap hit (${estimateCostUsd(accumulatedUsage)} >= ${maxCostUsd} USD); ` +
          `stopping at a case boundary`,
      );
      break;
    }

    for (let ai = 0; ai < arms.length; ai++) {
      const arm = arms[ai];
      try {
        const { result, usage } = await executor({ case: c, arm, signal });
        armResults[ai].records.push({ caseId: c.id, label: c.label, result });
        armResults[ai].usage = addUsage(armResults[ai].usage, usage);
        accumulatedUsage = addUsage(accumulatedUsage, usage);
      } catch (e) {
        armResults[ai].records.push({
          caseId: c.id,
          label: c.label,
          error: (e as Error).message,
        });
      }
    }
  }

  return {
    runName,
    datasetName,
    startedAt,
    caseCount: cases.length,
    costCapped,
    arms: armResults,
  };
}

// ---------------------------------------------------------------------------
// Diff layer (pure) — roll a run into a decision-grade summary.
// ---------------------------------------------------------------------------

export type ValidatorArmSummary = {
  arm: string;
  modelOverride?: string;
  /** Which in-repo template fed this arm — `"prior"` or `"current"`. NEVER
   *  Langfuse; see the module docstring's "Prompt source" section. */
  promptSource: ValidatorArm["promptSource"];
  /** `sha8` of the in-repo TEMPLATE body (`PROMPT_TEMPLATES[promptSource]`).
   *  Constant for the whole run — evidence that this arm's prompt came from
   *  the repo, not a network fetch, independent of any per-case rendering. */
  templateSha: string;
  metrics: ArmMetrics;
  costUsd: number;
  errors: Array<{ caseId: string; error: string }>;
};

export type ValidatorEvalSummary = {
  runName: string;
  datasetName: string;
  startedAt: string;
  caseCount: number;
  costCapped: boolean;
  arms: ValidatorArmSummary[];
  totalCostUsd: number;
};

/** Pair one arm's records against the fixture's labels, in record order,
 *  skipping any errored (no-`result`) record — `computeArmMetrics` only ever
 *  sees rows that actually produced a verdict. */
function pairForMetrics(
  cases: ValidatorAmbiguityCase[],
  armResult: ValidatorArmRunResult,
): { cases: ArmMetricsCaseInput[]; results: ArmMetricsResultInput[] } {
  const labelById = new Map(cases.map((c) => [c.id, c.label] as const));
  const pairedCases: ArmMetricsCaseInput[] = [];
  const pairedResults: ArmMetricsResultInput[] = [];
  for (const rec of armResult.records) {
    if (!rec.result) continue;
    const label = labelById.get(rec.caseId);
    if (label === undefined) continue;
    pairedCases.push({ label });
    pairedResults.push({
      ambiguous: rec.result.ambiguous,
      flaggedReasons: rec.result.flaggedReasons,
    });
  }
  return { cases: pairedCases, results: pairedResults };
}

/**
 * Roll a `ValidatorEvalRunResult` into a decision-grade `ValidatorEvalSummary`.
 * Pure — no I/O.
 */
export function computeValidatorSummary(
  run: ValidatorEvalRunResult,
  cases: ValidatorAmbiguityCase[],
): ValidatorEvalSummary {
  const arms: ValidatorArmSummary[] = run.arms.map((armResult) => {
    const { cases: pairedCases, results: pairedResults } = pairForMetrics(
      cases,
      armResult,
    );
    const metrics = computeArmMetrics(pairedCases, pairedResults);
    const errors = armResult.records
      .filter((r) => r.error !== undefined)
      .map((r) => ({ caseId: r.caseId, error: r.error! }));
    return {
      arm: armResult.arm.name,
      modelOverride: armResult.arm.modelOverride,
      promptSource: armResult.arm.promptSource,
      templateSha: sha8(PROMPT_TEMPLATES[armResult.arm.promptSource]),
      metrics,
      costUsd: estimateCostUsd(armResult.usage),
      errors,
    };
  });

  const totalUsage = run.arms.reduce(
    (acc, a) => addUsage(acc, a.usage),
    ZERO_USAGE,
  );

  return {
    runName: run.runName,
    datasetName: run.datasetName,
    startedAt: run.startedAt,
    caseCount: run.caseCount,
    costCapped: run.costCapped,
    arms,
    totalCostUsd: estimateCostUsd(totalUsage),
  };
}

// ---------------------------------------------------------------------------
// Output — markdown to stdout + JSON file to ./eval-runs/validator-<name>.json
// ---------------------------------------------------------------------------

const pct = (rate: number): string => `${(rate * 100).toFixed(1)}%`;
const usd = (value: number): string => `$${value.toFixed(4)}`;

export function renderValidatorMarkdownSummary(
  summary: ValidatorEvalSummary,
): string {
  const lines: string[] = [];
  lines.push(`# Validator alternative-enumeration eval \`${summary.runName}\``);
  lines.push("");
  lines.push(`- **dataset:** ${summary.datasetName}`);
  lines.push(`- **started:** ${summary.startedAt}`);
  lines.push(`- **cases:** ${summary.caseCount}`);
  lines.push(
    `- **prompt source:** every arm renders an in-repo template locally ` +
      `(PRIOR_TEMPLATE or the current VALIDATION_SYSTEM_PROMPT_TEMPLATE) — ` +
      `Langfuse's \`production\` label is NEVER consulted, so a pending-but-` +
      `unpushed prompt promotion cannot mask the prompt arm's effect`,
  );
  if (summary.costCapped) {
    lines.push(
      `- **⚠️ cost cap reached** — partial results (stopped at a case boundary)`,
    );
  }
  lines.push("");
  lines.push(
    "| Arm | Model | Prompt source | Template sha | Recall (ambiguous) | False-flag (clean) | Self-inconsistent | n | Cost |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const a of summary.arms) {
    lines.push(
      `| ${a.arm} | ${a.modelOverride ?? "production"} | repo:${a.promptSource} | ${a.templateSha} | ` +
        `${pct(a.metrics.recallOnAmbiguous)} | ${pct(a.metrics.falseFlagRateOnClean)} | ` +
        `${pct(a.metrics.selfInconsistentRate)} | ${a.metrics.n} | ${usd(a.costUsd)} |`,
    );
  }
  lines.push("");
  lines.push(`**Total cost:** ${usd(summary.totalCostUsd)}`);

  const errCount = summary.arms.reduce((n, a) => n + a.errors.length, 0);
  lines.push("");
  lines.push(`## Errors (${errCount})`);
  lines.push("");
  if (errCount === 0) {
    lines.push("_(none)_");
  } else {
    for (const a of summary.arms) {
      for (const e of a.errors) {
        lines.push(`- \`${a.arm}/${e.caseId}\`: ${e.error}`);
      }
    }
  }

  return lines.join("\n");
}

/** Persist the summary under `<outDir>/validator-<runName>.json`. Returns the
 *  absolute path written. Creates `outDir` if needed. */
export function writeValidatorSummaryJson(
  summary: ValidatorEvalSummary,
  outDir: string = EVAL_RUNS_DIR,
): string {
  mkdirSync(outDir, { recursive: true });
  const filename = path.join(outDir, `validator-${summary.runName}.json`);
  writeFileSync(filename, JSON.stringify(summary, null, 2), "utf8");
  return path.resolve(filename);
}

// ---------------------------------------------------------------------------
// CLI argv parser + usage
// ---------------------------------------------------------------------------

/**
 * 31 cases x 4 arms = 124 calls. Each call's system prompt is ~3-3.5k tokens
 * (cache-writable, but cases span multiple grammar points so cross-case
 * cache hits aren't guaranteed) plus a small per-case user prompt, with a
 * `candidateFillers` scratchpad in the output (~400-800 output tokens). Rough
 * worst-case (no cache credit): ~4k input + ~700 output tokens/call ≈
 * $0.022/call ≈ $2.70 for a full run. Default leaves real headroom for
 * caching working out worse than hoped, or a retried/slow run.
 */
const DEFAULT_MAX_COST_USD = 6;

export type EvalValidatorArgs = {
  limit?: number;
  maxCostUsd?: number;
  dryRun: boolean;
  runName?: string;
};

export function parseEvalValidatorArgs(
  argv: string[] = process.argv.slice(2),
): EvalValidatorArgs {
  const parsed = parseArgs({
    args: argv,
    options: {
      limit: { type: "string" },
      "max-cost-usd": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "run-name": { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    printUsage();
    process.exit(0);
  }

  let limit: number | undefined;
  if (parsed.values.limit !== undefined && parsed.values.limit !== "") {
    const n = Number(parsed.values.limit);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      throw new Error(
        `[eval-validator] --limit must be a positive integer, got ${parsed.values.limit}`,
      );
    }
    limit = n;
  }

  let maxCostUsd: number | undefined = DEFAULT_MAX_COST_USD;
  const rawMaxCost = parsed.values["max-cost-usd"];
  if (rawMaxCost !== undefined && rawMaxCost !== "") {
    const n = Number(rawMaxCost);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(
        `[eval-validator] --max-cost-usd must be a positive number, got ${rawMaxCost}`,
      );
    }
    maxCostUsd = n;
  }

  return {
    limit,
    maxCostUsd,
    dryRun: parsed.values["dry-run"] ?? false,
    runName: parsed.values["run-name"],
  };
}

function printUsage(): void {
  console.log(
    [
      "Usage: pnpm eval:validator [--limit <n>] [--max-cost-usd <n>]",
      "                           [--dry-run] [--run-name <name>]",
      "",
      "Replays the validator-ambiguity-cases.json fixture through 4 arms",
      "(baseline / prompt-only / model-only / both) so prompt and model",
      "effects are never confounded. Writes a markdown summary to stdout and",
      "a JSON summary to ./eval-runs/validator-<runName>.json.",
      "",
      "  --limit <n>          Cap the number of fixture cases replayed.",
      `  --max-cost-usd <n>   Hard cost ceiling; default ${DEFAULT_MAX_COST_USD}. Stops at a case boundary.`,
      "  --dry-run            Print the arm matrix + case counts; zero Anthropic calls.",
      "  --run-name <name>    Optional. Defaults to run-<ISO timestamp>.",
      "  --help               Show this message.",
      "",
      "NOTE: invoke as `pnpm eval:validator --flag`, NOT `pnpm eval:validator -- --flag`",
      "(the `--` form throws for every CLI in this package).",
    ].join("\n"),
  );
}

function deriveValidatorRunName(
  explicit: string | undefined,
  now: Date,
): string {
  if (explicit !== undefined && explicit !== "") return explicit;
  return `run-${now.toISOString()}`;
}

// ---------------------------------------------------------------------------
// CLI entry — only runs when invoked directly via `tsx scripts/eval-validator-run.ts`
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseEvalValidatorArgs();

  const fixturePath = path.join(FIXTURES_DIR, "validator-ambiguity-cases.json");
  const datasetName = path.basename(fixturePath);
  const allCases = loadValidatorCases(readFileSync(fixturePath, "utf8"));
  const cases = args.limit !== undefined ? allCases.slice(0, args.limit) : allCases;
  const runName = deriveValidatorRunName(args.runName, new Date());

  const ambiguousCount = cases.filter((c) => c.label === "ambiguous").length;
  const cleanCount = cases.filter((c) => c.label === "clean").length;

  console.log(
    `[eval-validator] dataset=${datasetName} cases=${cases.length} ` +
      `(ambiguous=${ambiguousCount}, clean=${cleanCount}) runName=${runName}`,
  );
  console.log(
    "[eval-validator] prompt source: every arm renders an in-repo template " +
      "(PRIOR_TEMPLATE or the current VALIDATION_SYSTEM_PROMPT_TEMPLATE) via " +
      "systemPromptOverride — Langfuse's `production` label is NEVER " +
      "consulted, so a pending-but-unpushed prompt promotion cannot mask " +
      "the prompt arm's effect (Fix Round 1).",
  );
  console.log("[eval-validator] arms:");
  for (const arm of ARMS) {
    const templateSha = sha8(PROMPT_TEMPLATES[arm.promptSource]);
    console.log(
      `  - ${arm.name}: model=${arm.modelOverride ?? "production default"}, ` +
        `prompt=repo:${arm.promptSource} (sha ${templateSha}, rendered locally)`,
    );
  }

  if (args.dryRun) {
    const roughPerCallUsd = 0.022;
    const estTotal = cases.length * ARMS.length * roughPerCallUsd;
    console.log(
      `[eval-validator] DRY RUN — no Claude calls. Rough cost estimate for a full run: ` +
        `$${estTotal.toFixed(2)} (${cases.length} cases x ${ARMS.length} arms x ~$${roughPerCallUsd}/call). ` +
        `--max-cost-usd default is $${DEFAULT_MAX_COST_USD}.`,
    );
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "[eval-validator] ANTHROPIC_API_KEY missing — eval-validator spends real Anthropic budget",
    );
    process.exit(1);
  }

  const client = createClaudeClient(apiKey);
  const result = await runValidatorEval({
    executor: makeRealValidatorExecutor(client),
    cases,
    arms: ARMS,
    runName,
    datasetName,
    maxCostUsd: args.maxCostUsd,
  });

  const summary = computeValidatorSummary(result, cases);
  console.log("");
  console.log(renderValidatorMarkdownSummary(summary));
  const jsonPath = writeValidatorSummaryJson(summary);
  console.log("");
  console.log(`[eval-validator] summary written to ${jsonPath}`);
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error("[eval-validator] unhandled failure:", err);
    process.exit(1);
  });
}
