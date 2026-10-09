/**
 * eval:fw-dedup-judge — measures the free-writing duplicate judge against the
 * #757 round-3 human clusters (docs/analysis/fw-round3-dedup-proposals-2026-10-07.json).
 * For each row, the judge runs once against the cell's other rows (the same
 * one-against-many shape production uses). A row is a true duplicate iff
 * another row shares its cluster. Reads prod content via DATABASE_URL
 * (read-only); writes ./eval-runs/<name>.json.
 *
 *   DATABASE_URL=<prod> pnpm eval:fw-dedup-judge [--out <name>] [--limit <cells>] [--max-cost-usd 5]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { inArray } from "drizzle-orm";
import { createDb, exercises, requireEnv } from "@language-drill/db";

import {
  ZERO_USAGE,
  addUsage,
  createClaudeClient,
  estimateCostUsd,
  freeWritingSummary,
  judgeFreeWritingDuplicate,
  type ClaudeUsageBreakdown,
  type FreeWritingPromptSummary,
} from "../src/index.js";
import { EVAL_RUNS_DIR } from "./eval-run.js";

export type ProposalCell = {
  language: string;
  level: string;
  cell: string;
  clusters: Array<{ angle: string; keep: string; demote: string[] }>;
};
export type LabeledRow = { id: string; cluster: number; isDuplicate: boolean };
export type JudgeCase = { cell: string; id: string; truth: boolean; predicted: boolean; reason: string };
export type JudgeScore = { tp: number; fp: number; fn: number; tn: number; precision: number; recall: number };

export const JUDGE_PRECISION_BAR = 0.9;
export const JUDGE_RECALL_BAR = 0.8;
/** Rows whose verdict stays malformed after the judge's retry; above this the run does not pass. */
export const MAX_JUDGE_ERROR_RATE = 0.02;

export function buildGroundTruth(cell: ProposalCell): LabeledRow[] {
  return cell.clusters.flatMap((c, i) => {
    const ids = [c.keep, ...c.demote];
    return ids.map((id) => ({ id, cluster: i, isDuplicate: ids.length > 1 }));
  });
}

export function scoreJudge(cases: readonly JudgeCase[]): JudgeScore {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const c of cases) {
    if (c.truth && c.predicted) tp++;
    else if (!c.truth && c.predicted) fp++;
    else if (c.truth && !c.predicted) fn++;
    else tn++;
  }
  return {
    tp, fp, fn, tn,
    precision: tp + fp === 0 ? 0 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
  };
}

export function judgePasses(s: JudgeScore): boolean {
  return s.precision >= JUDGE_PRECISION_BAR && s.recall >= JUDGE_RECALL_BAR;
}

/**
 * Row ids hand-confirmed as duplicates after a judge run disagreed with the
 * #757 label (docs/analysis/fw-round3-dedup-label-amendments-*.json). Their
 * truth is forced to "duplicate"; overturned entries keep the original label.
 */
export function confirmedDuplicateIds(amendments: unknown): Set<string> {
  const list =
    typeof amendments === "object" && amendments !== null
      ? (amendments as Record<string, unknown>).confirmedDuplicates
      : undefined;
  if (!Array.isArray(list)) return new Set();
  return new Set(
    list.flatMap((e) => {
      const id = typeof e === "object" && e !== null ? (e as Record<string, unknown>).rowId : undefined;
      return typeof id === "string" ? [id] : [];
    }),
  );
}

const DEFAULT_AMENDMENTS = fileURLToPath(
  new URL("../../../docs/analysis/fw-round3-dedup-label-amendments-2026-10-09.json", import.meta.url),
);

const DEFAULT_PROPOSALS = fileURLToPath(
  new URL("../../../docs/analysis/fw-round3-dedup-proposals-2026-10-07.json", import.meta.url),
);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      proposals: { type: "string", default: DEFAULT_PROPOSALS },
      // Pass `--amendments none` to score against the raw #757 labels.
      amendments: { type: "string", default: DEFAULT_AMENDMENTS },
      // Judge model override (default VALIDATION_MODEL). Cost figures and the
      // --max-cost-usd cap stay Sonnet-priced, so an Opus run spends ~5x the
      // reported cost.
      model: { type: "string" },
      out: { type: "string", default: `fw-dedup-judge-${new Date().toISOString().slice(0, 10)}` },
      limit: { type: "string" },
      "max-cost-usd": { type: "string", default: "5" },
    },
    allowPositionals: false,
  });
  const dbUrl = requireEnv("DATABASE_URL");
  console.log(`[fw-dedup-judge] reading rows (read-only) from ${new URL(dbUrl).host}`);
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  const db = createDb(dbUrl);
  const client = createClaudeClient(apiKey);
  const maxCost = Number(values["max-cost-usd"]);
  const confirmed =
    values.amendments === "none"
      ? new Set<string>()
      : confirmedDuplicateIds(JSON.parse(readFileSync(values.amendments!, "utf8")));
  if (values.model) {
    console.log(`[fw-dedup-judge] judge model ${values.model} — cost figures are Sonnet-priced`);
  }
  console.log(`[fw-dedup-judge] ${confirmed.size} hand-confirmed label amendments applied`);

  let cells = JSON.parse(readFileSync(values.proposals!, "utf8")) as ProposalCell[];
  if (values.limit) cells = cells.slice(0, Number(values.limit));

  const allIds = cells.flatMap((c) => buildGroundTruth(c).map((r) => r.id));
  const rows = await db
    .select({ id: exercises.id, contentJson: exercises.contentJson })
    .from(exercises)
    .where(inArray(exercises.id, allIds));
  const summaryById = new Map<string, FreeWritingPromptSummary>();
  for (const r of rows) {
    const s = freeWritingSummary(r.contentJson);
    if (s) summaryById.set(r.id, s);
  }

  const cases: JudgeCase[] = [];
  const disagreements: Array<JudgeCase & { candidate: FreeWritingPromptSummary; matched: FreeWritingPromptSummary | null }> = [];
  let usage: ClaudeUsageBreakdown = ZERO_USAGE;
  let missing = 0;
  const judgeErrors: Array<{ cell: string; id: string; truth: boolean; error: string }> = [];
  let capped = false;

  outer: for (const cell of cells) {
    const labeled = buildGroundTruth(cell).filter((r) => {
      const ok = summaryById.has(r.id);
      if (!ok) missing++;
      return ok;
    });
    for (const row of labeled) {
      if (estimateCostUsd(usage) >= maxCost) { capped = true; break outer; }
      const others = labeled.filter((o) => o.id !== row.id);
      const existing = others.map((o) => summaryById.get(o.id)!);
      // Truth is relative to the rows actually present: a duplicate whose
      // cluster-mates are all missing from the DB is not a findable duplicate.
      const truth = others.some((o) => o.cluster === row.cluster) || confirmed.has(row.id);
      const candidate = summaryById.get(row.id)!;
      // A verdict that stays malformed after the judge's own retry is recorded,
      // not fatal: in production it means "inserted flagged", so its rate is a
      // measurement in its own right.
      let judged: Awaited<ReturnType<typeof judgeFreeWritingDuplicate>>;
      try {
        judged = await judgeFreeWritingDuplicate(
          client,
          { candidate, existing, cefrLevel: cell.level },
          values.model ? { model: values.model } : {},
        );
      } catch (e) {
        judgeErrors.push({ cell: cell.cell, id: row.id, truth, error: (e as Error).message });
        continue;
      }
      const { result, tokenUsage } = judged;
      usage = addUsage(usage, tokenUsage);
      const c: JudgeCase = { cell: cell.cell, id: row.id, truth, predicted: result.duplicateOf !== null, reason: result.reason };
      cases.push(c);
      if (c.truth !== c.predicted) {
        disagreements.push({ ...c, candidate, matched: result.duplicateOf === null ? null : existing[result.duplicateOf] });
      }
    }
  }

  const score = scoreJudge(cases);
  const errorRate = cases.length + judgeErrors.length === 0 ? 0 : judgeErrors.length / (cases.length + judgeErrors.length);
  const passed = !capped && errorRate <= MAX_JUDGE_ERROR_RATE && judgePasses(score);
  const report = {
    runName: values.out, startedAt: new Date().toISOString(), cells: cells.length,
    rowsJudged: cases.length, rowsMissing: missing, costCapped: capped,
    judgeModel: values.model ?? "default", amendmentsApplied: confirmed.size,
    score, bars: { precision: JUDGE_PRECISION_BAR, recall: JUDGE_RECALL_BAR }, passed,
    costUsd: estimateCostUsd(usage), judgeErrors, errorRate, cases, disagreements,
  };
  mkdirSync(EVAL_RUNS_DIR, { recursive: true });
  const outPath = path.join(EVAL_RUNS_DIR, `${values.out}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`# Free-writing dedup judge — ${values.out}`);
  console.log(`rows judged ${cases.length} (missing ${missing})${capped ? " — COST CAPPED, partial" : ""}`);
  console.log(`precision ${score.precision.toFixed(3)} (bar ${JUDGE_PRECISION_BAR})  recall ${score.recall.toFixed(3)} (bar ${JUDGE_RECALL_BAR})`);
  console.log(`judge errors ${judgeErrors.length} (${(errorRate * 100).toFixed(1)}%, max ${MAX_JUDGE_ERROR_RATE * 100}%)`);
  console.log(`tp ${score.tp} fp ${score.fp} fn ${score.fn} tn ${score.tn}  cost $${report.costUsd.toFixed(2)}`);
  console.log(`**${passed ? "PASSED" : "FAILED"}** — ${disagreements.length} disagreements in ${outPath}`);
  if (!passed) process.exit(1);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error("[fw-dedup-judge] failed:", err);
    process.exit(1);
  });
}
