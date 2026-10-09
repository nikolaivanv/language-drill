/**
 * eval:fw-dedup — offline A/B of free-writing generation, never writes to the DB.
 *
 * Baseline: today's pipeline. One batch with title-only history (rendered with
 * the current heading), validated, accepted unless rejected or the title
 * collides.
 * Candidate: the shipped pipeline, simulated in memory. Attempt 0 is one batch
 * with frozen `title — task` history; outcomes are processed serially; each
 * draft is judged against the cell's prompts plus the drafts accepted so far;
 * a duplicate retries up to 3× with refreshed history, then gives up. A judge
 * failure accepts the draft as flagged.
 * Scoring: an independent judge (FW_DEDUP_SCORER_MODEL, a different model from the
 * pipeline's FREE_WRITING_DEDUP_MODEL) checks each accepted draft
 * against the cell's existing prompts and the arm's other accepted drafts.
 *
 *   DATABASE_URL=<prod> pnpm eval:fw-dedup --judge-report <abs path to eval:fw-dedup-judge JSON> [--out <name>] [--max-cost-usd 10]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type Anthropic from "@anthropic-ai/sdk";
import { and, count, eq, inArray } from "drizzle-orm";
import {
  buildCellKey,
  createDb,
  exercises,
  fetchFreeWritingPromptSummaries,
  getGrammarPoint,
  requireEnv,
  routeValidationResult,
  type Cell,
  type Db,
} from "@language-drill/db";
import {
  ExerciseType,
  resolveCellTargetFor,
  type CurriculumCefrLevel,
  type GrammarPoint,
  type LearningLanguage,
} from "@language-drill/shared";

import {
  ZERO_USAGE,
  addUsage,
  createClaudeClient,
  estimateCostUsd,
  freeWritingHistoryLine,
  freeWritingSummary,
  generateBatch,
  judgeFreeWritingDuplicate,
  validateDraft,
  type ClaudeUsageBreakdown,
  type ExerciseDraft,
  type FreeWritingPromptSummary,
  type GenerationSpec,
} from "../src/index.js";
import { EVAL_RUNS_DIR } from "./eval-run.js";

export type AcceptedDraft = { summary: FreeWritingPromptSummary; status: "auto-approved" | "flagged" };
export type ArmOutcome = {
  requested: number;
  accepted: AcceptedDraft[];
  validations: number;
  autoApproved: number;
  usage: ClaudeUsageBreakdown;
};
export type ArmMetrics = {
  requested: number;
  accepted: number;
  duplicates: number;
  duplicateRate: number;
  /** Accepted drafts minus distinct questions (within-arm pairs counted once). */
  redundant: number;
  underfillRate: number;
  approvalRate: number;
  costUsd: number;
};

export const CANDIDATE_MAX_DUP_RATE = 0.05;
export const BASELINE_MIN_DUP_RATE = 0.2;
export const MAX_APPROVAL_DROP = 0.1;
/**
 * Independent scorer: must differ from the pipeline judge (FREE_WRITING_DEDUP_MODEL,
 * Opus 4.8). Opus 5.x would be the obvious pick but rejects `thinking: disabled`,
 * which the judge's per-model guard sends; Opus 4.7 is guard-compatible.
 */
export const FW_DEDUP_SCORER_MODEL = "claude-opus-4-7";
const MAX_RETRIES = 3;

export function normalizeTitle(t: string): string {
  return t.toLowerCase().normalize("NFKD").replace(/\p{Diacritic}+/gu, "").replace(/\s+/gu, " ").trim();
}

/**
 * Greedy collapse of row-level duplicate flags: a flagged draft is redundant iff
 * it matched an existing prompt, or an earlier draft in the arm exists (so the
 * first member of a within-arm pair is not counted when no existing prompt matched).
 */
export function redundantCount(flags: readonly boolean[], duplicateOfIsExisting: readonly boolean[]): number {
  let n = 0;
  flags.forEach((f, i) => {
    if (f && (duplicateOfIsExisting[i] === true || i > 0)) n++;
  });
  return n;
}

export function armMetrics(
  outcomes: readonly ArmOutcome[],
  duplicateFlags: readonly boolean[][],
  existingMatchFlags: readonly boolean[][] = [],
): ArmMetrics {
  let redundant = 0;
  let requested = 0, accepted = 0, duplicates = 0, validations = 0, autoApproved = 0;
  let usage: ClaudeUsageBreakdown = ZERO_USAGE;
  outcomes.forEach((o, i) => {
    requested += o.requested;
    accepted += o.accepted.length;
    validations += o.validations;
    autoApproved += o.autoApproved;
    usage = addUsage(usage, o.usage);
    duplicates += (duplicateFlags[i] ?? []).filter(Boolean).length;
    redundant += redundantCount(duplicateFlags[i] ?? [], existingMatchFlags[i] ?? []);
  });
  return {
    requested, accepted, duplicates, redundant,
    duplicateRate: accepted === 0 ? 0 : duplicates / accepted,
    underfillRate: requested === 0 ? 0 : (requested - accepted) / requested,
    approvalRate: validations === 0 ? 0 : autoApproved / validations,
    costUsd: estimateCostUsd(usage),
  };
}

export function fwDedupVerdict(input: {
  judgePassed: boolean;
  baseline: ArmMetrics;
  candidate: ArmMetrics;
}): "ship-ready" | "inspect" | "inconclusive" {
  if (input.baseline.duplicateRate < BASELINE_MIN_DUP_RATE) return "inconclusive";
  const approvalDelta = input.candidate.approvalRate - input.baseline.approvalRate;
  return input.judgePassed &&
    input.candidate.duplicateRate <= CANDIDATE_MAX_DUP_RATE &&
    approvalDelta >= -MAX_APPROVAL_DROP - 1e-9
    ? "ship-ready"
    : "inspect";
}

type EvalCell = { cell: Cell; requested: number; existing: FreeWritingPromptSummary[] };

function specFor(c: EvalCell, count: number, batchSeed: string, priorPoolSurfaces: string[]): GenerationSpec {
  return {
    language: c.cell.language as GenerationSpec["language"],
    cefrLevel: c.cell.cefrLevel,
    exerciseType: ExerciseType.FREE_WRITING,
    grammarPoint: c.cell.grammarPoint,
    topicDomain: null,
    count,
    batchSeed,
    priorPoolSurfaces,
  };
}

async function validated(client: Anthropic, draft: ExerciseDraft, spec: GenerationSpec) {
  const { result, tokenUsage } = await validateDraft(client, draft, spec);
  return { status: routeValidationResult(result).reviewStatus, usage: tokenUsage };
}

async function runBaseline(client: Anthropic, c: EvalCell): Promise<ArmOutcome> {
  const out: ArmOutcome = { requested: c.requested, accepted: [], validations: 0, autoApproved: 0, usage: ZERO_USAGE };
  if (c.requested === 0) return out;
  const spec = specFor(c, c.requested, "eval-fw-baseline", c.existing.map((s) => s.title));
  const batch = await generateBatch(client, spec);
  out.usage = addUsage(out.usage, batch.tokenUsage);
  const seen = new Set(c.existing.map((s) => normalizeTitle(s.title)));
  for (const draft of batch.drafts) {
    const v = await validated(client, draft, spec);
    out.usage = addUsage(out.usage, v.usage);
    out.validations++;
    if (v.status === "auto-approved") out.autoApproved++;
    const summary = freeWritingSummary(draft.contentJson);
    if (v.status === "rejected" || summary === null) continue;
    const key = normalizeTitle(summary.title);
    if (seen.has(key)) continue; // title collision, as the dedup index would reject
    seen.add(key);
    out.accepted.push({ summary, status: v.status === "auto-approved" ? "auto-approved" : "flagged" });
  }
  return out;
}

async function runCandidate(client: Anthropic, c: EvalCell): Promise<ArmOutcome> {
  const out: ArmOutcome = { requested: c.requested, accepted: [], validations: 0, autoApproved: 0, usage: ZERO_USAGE };
  if (c.requested === 0) return out;
  const pool = (): FreeWritingPromptSummary[] => [...c.existing, ...out.accepted.map((a) => a.summary)];
  const spec0 = specFor(c, c.requested, "eval-fw-candidate", c.existing.map(freeWritingHistoryLine));
  const batch = await generateBatch(client, spec0);
  out.usage = addUsage(out.usage, batch.tokenUsage);

  for (let slot = 0; slot < batch.drafts.length; slot++) {
    let draft: ExerciseDraft | undefined = batch.drafts[slot];
    let deduped = false;
    for (let attempt = 0; attempt <= MAX_RETRIES && draft; attempt++) {
      const v = await validated(client, draft, spec0);
      out.usage = addUsage(out.usage, v.usage);
      out.validations++;
      if (v.status === "auto-approved") out.autoApproved++;
      const summary = freeWritingSummary(draft.contentJson);
      let retry = false;
      if (v.status === "rejected" || summary === null) {
        if (!deduped) break; // a rejected first attempt ends the slot, as in prod
        retry = true;
      } else {
        let status: "auto-approved" | "flagged" = v.status === "auto-approved" ? "auto-approved" : "flagged";
        let dup = false;
        try {
          const j = await judgeFreeWritingDuplicate(client, { candidate: summary, existing: pool(), cefrLevel: c.cell.cefrLevel });
          out.usage = addUsage(out.usage, j.tokenUsage);
          dup = j.result.duplicateOf !== null;
        } catch {
          status = "flagged"; // judge unavailable → inserted flagged
        }
        if (!dup) {
          out.accepted.push({ summary, status });
          break;
        }
        deduped = true;
        retry = true;
      }
      if (!retry || attempt === MAX_RETRIES) break;
      const r = await generateBatch(
        client,
        specFor(c, 1, `eval-fw-candidate::${slot}::retry-${attempt + 1}`, pool().map(freeWritingHistoryLine)),
      );
      out.usage = addUsage(out.usage, r.tokenUsage);
      draft = r.drafts[0];
    }
  }
  return out;
}

async function scoreArm(client: Anthropic, c: EvalCell, arm: ArmOutcome): Promise<{ flags: boolean[]; existingMatch: boolean[]; usage: ClaudeUsageBreakdown; errors: number }> {
  const flags: boolean[] = [];
  const existingMatch: boolean[] = [];
  let usage: ClaudeUsageBreakdown = ZERO_USAGE;
  let errors = 0;
  for (let i = 0; i < arm.accepted.length; i++) {
    const others = [...c.existing, ...arm.accepted.filter((_, j) => j !== i).map((a) => a.summary)];
    try {
      const j = await judgeFreeWritingDuplicate(
        client,
        { candidate: arm.accepted[i].summary, existing: others, cefrLevel: c.cell.cefrLevel },
        { model: FW_DEDUP_SCORER_MODEL },
      );
      usage = addUsage(usage, j.tokenUsage);
      flags.push(j.result.duplicateOf !== null);
      existingMatch.push(j.result.duplicateOf !== null && j.result.duplicateOf < c.existing.length);
    } catch {
      errors++;
      flags.push(false);
      existingMatch.push(false);
    }
  }
  return { flags, existingMatch, usage, errors };
}

async function loadCell(db: Db, d: { language: string; cefrLevel: string; grammarPointKey: string }): Promise<EvalCell> {
  const gp = getGrammarPoint(d.grammarPointKey) as GrammarPoint | undefined;
  if (!gp) throw new Error(`unknown grammarPointKey ${d.grammarPointKey}`);
  const cell: Cell = {
    language: d.language as LearningLanguage,
    cefrLevel: d.cefrLevel as CurriculumCefrLevel,
    exerciseType: ExerciseType.FREE_WRITING,
    grammarPoint: gp,
    cellKey: buildCellKey({ language: d.language, cefrLevel: d.cefrLevel, exerciseType: ExerciseType.FREE_WRITING, grammarPointKey: d.grammarPointKey }),
  };
  const [{ n }] = await db
    .select({ n: count() })
    .from(exercises)
    .where(
      and(
        eq(exercises.language, cell.language),
        eq(exercises.difficulty, cell.cefrLevel),
        eq(exercises.type, ExerciseType.FREE_WRITING),
        eq(exercises.grammarPointKey, gp.key),
        inArray(exercises.reviewStatus, ["auto-approved", "manual-approved"]),
      ),
    );
  const target = resolveCellTargetFor({ exerciseType: ExerciseType.FREE_WRITING, cefrLevel: cell.cefrLevel, grammarPoint: gp });
  return { cell, requested: Math.max(0, target - Number(n)), existing: await fetchFreeWritingPromptSummaries(db, cell) };
}

const DEFAULT_DATASET = fileURLToPath(new URL("./fixtures/cells-fw-dedup.json", import.meta.url));

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "judge-report": { type: "string" },
      dataset: { type: "string", default: DEFAULT_DATASET },
      out: { type: "string", default: `fw-dedup-${new Date().toISOString().slice(0, 10)}` },
      "max-cost-usd": { type: "string", default: "10" },
    },
    allowPositionals: false,
  });
  if (!values["judge-report"]) throw new Error("--judge-report <abs path to eval:fw-dedup-judge JSON> is required");
  const judgePassed = (JSON.parse(readFileSync(values["judge-report"], "utf8")) as { passed?: boolean }).passed === true;
  const dbUrl = requireEnv("DATABASE_URL");
  console.log(`[fw-dedup] reading the pool (read-only) from ${new URL(dbUrl).host}; judge passed=${judgePassed}`);
  const db = createDb(dbUrl);
  const client = createClaudeClient(requireEnv("ANTHROPIC_API_KEY"));
  const maxCost = Number(values["max-cost-usd"]);
  const dataset = JSON.parse(readFileSync(values.dataset!, "utf8")) as Array<{ language: string; cefrLevel: string; grammarPointKey: string }>;

  const perCell: Array<Record<string, unknown>> = [];
  const base: ArmOutcome[] = [], cand: ArmOutcome[] = [];
  const baseFlags: boolean[][] = [], candFlags: boolean[][] = [];
  const baseExisting: boolean[][] = [], candExisting: boolean[][] = [];
  let scoringUsage: ClaudeUsageBreakdown = ZERO_USAGE;
  let scoringErrors = 0;
  let capped = false;

  for (const d of dataset) {
    const spent = estimateCostUsd([...base, ...cand].reduce((u, o) => addUsage(u, o.usage), scoringUsage));
    if (spent >= maxCost) { capped = true; break; }
    const c = await loadCell(db, d);
    const b = await runBaseline(client, c);
    const k = await runCandidate(client, c);
    const bs = await scoreArm(client, c, b);
    const ks = await scoreArm(client, c, k);
    scoringUsage = addUsage(addUsage(scoringUsage, bs.usage), ks.usage);
    scoringErrors += bs.errors + ks.errors;
    base.push(b); cand.push(k); baseFlags.push(bs.flags); candFlags.push(ks.flags);
    baseExisting.push(bs.existingMatch); candExisting.push(ks.existingMatch);
    perCell.push({
      cellKey: c.cell.cellKey, requested: c.requested, existing: c.existing,
      baseline: { accepted: b.accepted, duplicateFlags: bs.flags },
      candidate: { accepted: k.accepted, duplicateFlags: ks.flags },
    });
    console.log(`[fw-dedup] ${c.cell.cellKey}: requested ${c.requested}; baseline ${b.accepted.length} (${bs.flags.filter(Boolean).length} dup), candidate ${k.accepted.length} (${ks.flags.filter(Boolean).length} dup)`);
  }

  const baseline = armMetrics(base, baseFlags, baseExisting);
  const candidate = armMetrics(cand, candFlags, candExisting);
  const verdict = capped ? "inspect" : fwDedupVerdict({ judgePassed, baseline, candidate });
  const report = {
    runName: values.out, startedAt: new Date().toISOString(), judgePassed, costCapped: capped,
    baseline, candidate, verdict, scoringErrors, scoringCostUsd: estimateCostUsd(scoringUsage), perCell,
  };
  mkdirSync(EVAL_RUNS_DIR, { recursive: true });
  const outPath = path.join(EVAL_RUNS_DIR, `${values.out}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`\n# Free-writing dedup A/B — ${values.out}${capped ? " (COST CAPPED, partial)" : ""}`);
  console.log("| | Baseline | Candidate |\n|---|---|---|");
  console.log(`| requested | ${baseline.requested} | ${candidate.requested} |`);
  console.log(`| accepted | ${baseline.accepted} | ${candidate.accepted} |`);
  console.log(`| duplicate rate | ${pct(baseline.duplicateRate)} | ${pct(candidate.duplicateRate)} |`);
  console.log(`| redundant rows | ${baseline.redundant} | ${candidate.redundant} |`);
  console.log(`| underfill | ${pct(baseline.underfillRate)} | ${pct(candidate.underfillRate)} |`);
  console.log(`| approval | ${pct(baseline.approvalRate)} | ${pct(candidate.approvalRate)} |`);
  console.log(`| cost | $${baseline.costUsd.toFixed(2)} | $${candidate.costUsd.toFixed(2)} |`);
  console.log(`\n**Verdict:** ${verdict} — ship-ready iff judge passed, candidate dup ≤ 5%, baseline dup ≥ 20%, approval Δ ≥ −10pp.`);
  console.log(`scoring $${report.scoringCostUsd.toFixed(2)}, ${scoringErrors} scoring errors; full report ${outPath}`);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error("[fw-dedup] failed:", err);
    process.exit(1);
  });
}
