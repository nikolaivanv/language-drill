/**
 * packages/ai — qa-sample-run CLI. Spot-checks the approved exercise pool by
 * crafting three intent-labeled answers per sampled exercise (Opus) and running
 * each through the production evaluator, flagging (exercise -> evaluator)
 * contract defects to ./qa-runs/<name>.json. Author-run; a spotlight, not a gate.
 *
 * Built bottom-up: sampling helpers landed in Task 5. Report assembly +
 * orchestration + CLI entry (Task 6) below.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, sql } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { CefrLevel, Language, type ExerciseContent } from "@language-drill/shared";
import { createDb, resolveEvaluationGuidance, exercises } from "@language-drill/db";
import {
  addUsage,
  classifyVerdicts,
  craftProbeAnswers,
  createClaudeClient,
  estimateCostUsd,
  evaluateAnswer,
  renderLearnerView,
  FAIL_THRESHOLD,
  PASS_THRESHOLD,
  ZERO_USAGE,
  type ClaudeUsageBreakdown,
  type ProbeScores,
  type QaFlagReason,
} from "../src/index.js";
import { wrapForUsageCapture } from "./eval-run.js";

export type PoolRow = {
  id: string;
  type: string;
  language: string;
  difficulty: string;
  grammarPointKey: string | null;
  contentJson: unknown;
};

/** The six exercise-type db values routed through `evaluateAnswer`. */
export const QA_SAMPLE_TYPES = [
  "cloze",
  "translation",
  "vocab_recall",
  "sentence_construction",
  "conjugation",
  "contextual_paraphrase",
] as const;

/** Small deterministic PRNG (mulberry32) — reproducible sampling under --seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded Fisher–Yates. Returns a new array; does not mutate the input. */
function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Group rows by grammarPointKey (nulls share one bucket), shuffle each group
 * with the seeded RNG, and take up to `perPoint` from each. Deterministic for a
 * given (rows-set, perPoint, seed).
 */
export function samplePerPoint(rows: PoolRow[], perPoint: number, seed: number): PoolRow[] {
  // Sort by id first so the result depends only on (row-set, perPoint, seed) —
  // never on the arrival order of `rows` (the DB query has no stable ORDER BY).
  const sorted = rows.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groups = new Map<string, PoolRow[]>();
  for (const r of sorted) {
    const key = r.grammarPointKey ?? " null";
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const rng = mulberry32(seed);
  const out: PoolRow[] = [];
  // Stable group order (sorted keys) so the seed alone determines the result.
  for (const key of [...groups.keys()].sort()) {
    out.push(...shuffle(groups.get(key)!, rng).slice(0, perPoint));
  }
  return out;
}

export type ProbeVerdict = { score: number; band: "pass" | "fail" | "deadzone" };

export type QaFlagRecord = {
  exerciseId: string;
  grammarPointKey: string | null;
  type: string;
  language: string;
  cefr: string;
  flags: QaFlagReason[];
  ambiguous: boolean;
  ambiguityNote: string;
  answers: { correct: string; wrong: string; alt: string | null };
  confidence: number;
  verdicts: { correct: ProbeVerdict; wrong: ProbeVerdict; alt: ProbeVerdict | null };
  /** The exact user-facing render the crafter solved (spec's `promptSeen`). */
  promptSeen: string;
};

export type QaRunReport = {
  meta: {
    language: string; cefr: string | null; perPoint: number; sampledCount: number;
    seed: number; model: string; costUsd: number; startedAt: string;
  };
  summary: {
    sampled: number; flagged: number;
    byReason: Record<string, number>;
    byType: Record<string, number>;
    ambiguityNotes: number; lowConfidenceSolves: number;
  };
  flags: QaFlagRecord[];
  ambiguity: Array<{ exerciseId: string; note: string }>;
  errors: Array<{ exerciseId: string; stage: string; message: string }>;
};

/** Pure roll-up of per-exercise records into the report shape. */
export function buildReport(
  records: QaFlagRecord[],
  meta: QaRunReport["meta"],
  errors: QaRunReport["errors"] = [],
): QaRunReport {
  const flagged = records.filter((r) => r.flags.length > 0);
  const byReason: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let lowConfidenceSolves = 0;
  for (const r of flagged) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    for (const reason of r.flags) {
      byReason[reason] = (byReason[reason] ?? 0) + 1;
      if (reason === "low_confidence_solve") lowConfidenceSolves++;
    }
  }
  const ambiguity = records
    .filter((r) => r.ambiguous && r.ambiguityNote !== "")
    .map((r) => ({ exerciseId: r.exerciseId, note: r.ambiguityNote }));
  return {
    meta,
    summary: {
      sampled: records.length,
      flagged: flagged.length,
      byReason,
      byType,
      ambiguityNotes: ambiguity.length,
      lowConfidenceSolves,
    },
    flags: flagged,
    ambiguity,
    errors,
  };
}

function band(score: number): ProbeVerdict["band"] {
  if (score >= PASS_THRESHOLD) return "pass";
  if (score <= FAIL_THRESHOLD) return "fail";
  return "deadzone";
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[qa-sample] ${name} is required`);
  return v;
}

/** Evaluate one answer string against an exercise; return score + captured usage. */
async function scoreAnswer(
  client: Anthropic,
  content: ExerciseContent,
  answer: string,
  language: Language,
  difficulty: CefrLevel,
  grounding: ReturnType<typeof resolveEvaluationGuidance>,
): Promise<{ score: number; usage: ClaudeUsageBreakdown }> {
  const sink: { current: ClaudeUsageBreakdown | undefined } = { current: undefined };
  const wrapped = wrapForUsageCapture(client, sink);
  const result = await evaluateAnswer(wrapped, {
    exercise: content,
    userAnswer: answer,
    language,
    difficulty,
    grammarGuidance: grounding.grammarGuidance,
    attributionKeys: grounding.attributionKeys,
  });
  return { score: result.score, usage: sink.current ?? ZERO_USAGE };
}

type QaArgs = {
  language: string;
  cefr?: string;
  perPoint: number;
  grammarPoint?: string;
  types: string[];
  limit?: number;
  maxCostUsd?: number;
  model?: string;
  out?: string;
  seed: number;
  dryRun: boolean;
};

export function parseQaArgs(argv: string[]): QaArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      language: { type: "string" },
      cefr: { type: "string" },
      "per-point": { type: "string", default: "2" },
      "grammar-point": { type: "string" },
      type: { type: "string" },
      limit: { type: "string" },
      "max-cost-usd": { type: "string" },
      model: { type: "string" },
      out: { type: "string" },
      seed: { type: "string", default: "1" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (!values.language) throw new Error("[qa-sample] --language is required");
  return {
    language: values.language,
    cefr: values.cefr,
    perPoint: Number(values["per-point"]),
    grammarPoint: values["grammar-point"],
    types: values.type ? values.type.split(",").map((s) => s.trim()) : [...QA_SAMPLE_TYPES],
    limit: values.limit ? Number(values.limit) : undefined,
    maxCostUsd: values["max-cost-usd"] ? Number(values["max-cost-usd"]) : undefined,
    model: values.model,
    out: values.out,
    seed: Number(values.seed),
    dryRun: Boolean(values["dry-run"]),
  };
}

async function main(): Promise<void> {
  const args = parseQaArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const db = createDb(requireEnv("DATABASE_URL"));

  const conds = [
    eq(exercises.language, args.language),
    inArray(exercises.type, args.types),
    sql`${exercises.reviewStatus} IN ('auto-approved', 'manual-approved')`,
  ];
  if (args.cefr) conds.push(eq(exercises.difficulty, args.cefr));
  if (args.grammarPoint) conds.push(eq(exercises.grammarPointKey, args.grammarPoint));

  const rows = (await db
    .select({
      id: exercises.id,
      type: exercises.type,
      language: exercises.language,
      difficulty: exercises.difficulty,
      grammarPointKey: exercises.grammarPointKey,
      contentJson: exercises.contentJson,
    })
    .from(exercises)
    .where(and(...conds))) as PoolRow[];

  let sampled = samplePerPoint(rows, args.perPoint, args.seed);
  if (args.limit !== undefined) sampled = sampled.slice(0, args.limit);

  console.log(`[qa-sample] pool=${rows.length} sampled=${sampled.length} ids=${sampled.map((r) => r.id).join(",")}`);

  if (args.dryRun) {
    for (const r of sampled) {
      console.log(`\n--- ${r.id} (${r.type}) ---\n${renderLearnerView(r.contentJson as ExerciseContent)}`);
    }
    const perExercise = 0.02; // rough Opus-craft + 3 Sonnet-eval estimate
    console.log(`\n[qa-sample] DRY RUN — no Claude calls. Rough cost estimate: $${(sampled.length * perExercise).toFixed(2)}`);
    return;
  }

  const client = createClaudeClient(requireEnv("ANTHROPIC_API_KEY"));
  const records: QaFlagRecord[] = [];
  const errors: QaRunReport["errors"] = [];
  let usage: ClaudeUsageBreakdown = ZERO_USAGE;
  let costCapped = false;

  for (const r of sampled) {
    if (args.maxCostUsd !== undefined && estimateCostUsd(usage) >= args.maxCostUsd) {
      costCapped = true;
      console.log(`[qa-sample] --max-cost-usd reached; stopping before ${r.id}`);
      break;
    }
    const content = r.contentJson as ExerciseContent;
    const language = r.language as Language;
    const difficulty = r.difficulty as CefrLevel;
    const grounding = resolveEvaluationGuidance({
      grammarPointKey: r.grammarPointKey,
      language: r.language,
      difficulty: r.difficulty,
    });
    const promptSeen = renderLearnerView(content);
    try {
      const { probe, usage: craftUsage } = await craftProbeAnswers(client, {
        learnerView: promptSeen,
        language: r.language,
        cefrLevel: r.difficulty,
        exerciseType: r.type,
        model: args.model,
      });
      usage = addUsage(usage, craftUsage);

      // Label-carrying tuples: never re-derive the label by value comparison —
      // the crafter can legitimately return identical strings across slots.
      const answers: Array<readonly ["correct" | "wrong" | "alt", string]> = [
        ["correct", probe.correct],
        ["wrong", probe.wrong],
        ...(probe.alt !== null ? [["alt", probe.alt] as const] : []),
      ];
      const scored: Partial<Record<"correct" | "wrong" | "alt", number>> = {};
      for (const [label, answer] of answers) {
        const { score, usage: evalUsage } = await scoreAnswer(client, content, answer, language, difficulty, grounding);
        usage = addUsage(usage, evalUsage);
        scored[label] = score;
      }

      const scores: ProbeScores = {
        correct: scored.correct!,
        wrong: scored.wrong!,
        alt: probe.alt !== null ? scored.alt! : null,
      };
      const flags = classifyVerdicts(scores, probe.correctConfidence);

      records.push({
        exerciseId: r.id,
        grammarPointKey: r.grammarPointKey,
        type: r.type,
        language: r.language,
        cefr: r.difficulty,
        flags,
        ambiguous: probe.ambiguous,
        ambiguityNote: probe.ambiguityNote,
        answers: { correct: probe.correct, wrong: probe.wrong, alt: probe.alt },
        confidence: probe.correctConfidence,
        verdicts: {
          correct: { score: scores.correct, band: band(scores.correct) },
          wrong: { score: scores.wrong, band: band(scores.wrong) },
          alt: scores.alt !== null ? { score: scores.alt, band: band(scores.alt) } : null,
        },
        promptSeen,
      });
    } catch (e) {
      errors.push({ exerciseId: r.id, stage: "run", message: (e as Error).message });
    }
  }

  const report = buildReport(records, {
    language: args.language,
    cefr: args.cefr ?? null,
    perPoint: args.perPoint,
    sampledCount: sampled.length,
    seed: args.seed,
    model: args.model ?? "claude-opus-4-8",
    costUsd: estimateCostUsd(usage),
    startedAt,
  }, errors);

  const name = args.out ?? `qa-${args.language}-${args.cefr ?? "all"}-${startedAt}`;
  mkdirSync("./qa-runs", { recursive: true });
  const file = path.join("./qa-runs", `${name}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  console.log(
    `[qa-sample] ${report.summary.flagged}/${report.summary.sampled} flagged${costCapped ? " (cost-capped)" : ""} · $${report.meta.costUsd.toFixed(4)} · ${path.resolve(file)}`,
  );
}

// Only run when invoked directly (not when imported by the test) — mirrors the
// guard in eval-run.ts.
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((e) => {
    console.error("[qa-sample] unhandled failure:", e);
    process.exit(1);
  });
}
