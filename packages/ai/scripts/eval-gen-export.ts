/**
 * packages/ai — eval-gen-export CLI (generation-eval-harness Task 19).
 *
 * Produces a *failure-prone* cell dataset for `eval-gen-run.ts` by sampling the
 * worst-performing cells from `generation_jobs`. For every distinct `cellKey`
 * it sums the per-job draft counts, derives an approval rate
 * (`approvedCount / producedCount` — the same "auto-approved ÷ total drafts"
 * shape the runner reports), sorts **ascending** (lowest approval = most
 * failure-prone first), takes the worst `--sample`, maps each `cellKey` back to
 * a `CellDescriptor`, and writes the array as JSON to `--out`.
 *
 * The runner does NOT depend on this script — `fixtures/cells-smoke.json`
 * already unblocks manual runs and the loader tests. This exists to point the
 * harness at the cells most likely to regress under a prompt change.
 *
 * Invocation (see `pnpm eval:gen:export`):
 *   tsx scripts/eval-gen-export.ts \
 *     --sample 20 --out ./eval-runs/cells-worst.json \
 *     [--language TR] [--cefr A1] [--allow-prod]
 *
 * Read-only: a single grouped SELECT against `generation_jobs`. No writes to
 * any table; the only output is the `--out` JSON file.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { sql } from "drizzle-orm";

import { CefrLevel, ExerciseType, Language } from "@language-drill/shared";
import {
  type Db,
  createDb,
  generationJobs,
  getGrammarPoint,
  requireEnv,
} from "@language-drill/db";

import { assertNotProdWithoutAllow } from "./eval-run.js";
import type { CellDescriptor } from "./eval-gen-run.js";

// ---------------------------------------------------------------------------
// cellKey → CellDescriptor
// ---------------------------------------------------------------------------

const isCefrLevel = (v: string): v is CefrLevel =>
  (Object.values(CefrLevel) as string[]).includes(v);
const isExerciseType = (v: string): v is ExerciseType =>
  (Object.values(ExerciseType) as string[]).includes(v);

/**
 * Parse a `generation_jobs.cell_key` (`<lang>:<level>:<type>:<grammar_point>`,
 * with `lang/level/type` lowercased by `buildCellKey`) back into a typed
 * `CellDescriptor`. Returns `null` for any cellKey that doesn't round-trip to a
 * valid, non-EN cell with a known grammar point — the caller skips + logs it so
 * a single malformed/legacy key never aborts the export.
 *
 * `grammar_point_key` never contains a colon, so a 4-way split is unambiguous;
 * the head three segments are uppercased back to the enum literals
 * (`exerciseType` is already lowercase, matching `ExerciseType.*`).
 */
export function cellKeyToDescriptor(cellKey: string): CellDescriptor | null {
  const parts = cellKey.split(":");
  if (parts.length !== 4) return null;
  const [rawLang, rawLevel, rawType, grammarPointKey] = parts;

  const language = rawLang.toUpperCase();
  const cefrLevel = rawLevel.toUpperCase();
  const exerciseType = rawType; // ExerciseType values are lowercase

  if (
    !(Object.values(Language) as string[]).includes(language) ||
    language === Language.EN ||
    !isCefrLevel(cefrLevel) ||
    !isExerciseType(exerciseType) ||
    grammarPointKey === "" ||
    !getGrammarPoint(grammarPointKey)
  ) {
    return null;
  }

  return {
    language: language as Language,
    cefrLevel,
    exerciseType,
    grammarPointKey,
  };
}

// ---------------------------------------------------------------------------
// Per-cell approval stats — grouped read from generation_jobs
// ---------------------------------------------------------------------------

/** One cell's summed draft counts across every `generation_jobs` row for it. */
export type CellApprovalRow = {
  cellKey: string;
  produced: number;
  approved: number;
};

/** A cell ranked by approval rate, with its reconstructed descriptor. */
export type RankedCell = {
  cellKey: string;
  descriptor: CellDescriptor;
  produced: number;
  approved: number;
  /** `approved / produced` in [0,1]. */
  approvalRate: number;
};

/**
 * Port for the grouped read so the orchestrator + ranking are testable without
 * a live Drizzle pool. The real implementation (`createGenerationJobStatsSource`)
 * runs one grouped SELECT; tests inject a fixed row list.
 */
export type GenerationJobStatsSource = {
  fetchCellApprovalRows: () => Promise<CellApprovalRow[]>;
};

/**
 * Real `GenerationJobStatsSource`: `SELECT cell_key, sum(produced_count),
 * sum(approved_count) ... GROUP BY cell_key`. `sum()` over `integer` comes back
 * as a string (pg `bigint`), so each is coerced via `Number`. Read-only.
 */
export function createGenerationJobStatsSource(
  db: Db,
): GenerationJobStatsSource {
  return {
    async fetchCellApprovalRows() {
      const rows = await db
        .select({
          cellKey: generationJobs.cellKey,
          produced: sql<string>`coalesce(sum(${generationJobs.producedCount}), 0)`,
          approved: sql<string>`coalesce(sum(${generationJobs.approvedCount}), 0)`,
        })
        .from(generationJobs)
        .groupBy(generationJobs.cellKey);
      return rows.map((r) => ({
        cellKey: r.cellKey,
        produced: Number(r.produced),
        approved: Number(r.approved),
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Ranking — failure-prone first
// ---------------------------------------------------------------------------

/**
 * Rank cells by approval rate ascending (most failure-prone first), after:
 *   - dropping zero-production cells (no quality signal — never generated),
 *   - dropping cellKeys that don't map to a valid descriptor (logged by caller
 *     via the `skipped` return),
 *   - applying the optional `--language` / `--cefr` filters (case-insensitive),
 * then taking the worst `sample`. Ties (equal approval rate) break by `cellKey`
 * for a deterministic, reproducible dataset.
 */
export function rankFailureProneCells(
  rows: readonly CellApprovalRow[],
  opts: { sample: number; language?: string; cefr?: string },
): { ranked: RankedCell[]; skipped: string[] } {
  const skipped: string[] = [];
  const ranked: RankedCell[] = [];

  const wantLang = opts.language?.toUpperCase();
  const wantCefr = opts.cefr?.toUpperCase();

  for (const row of rows) {
    if (row.produced <= 0) continue;
    const descriptor = cellKeyToDescriptor(row.cellKey);
    if (!descriptor) {
      skipped.push(row.cellKey);
      continue;
    }
    if (wantLang && descriptor.language !== wantLang) continue;
    if (wantCefr && descriptor.cefrLevel !== wantCefr) continue;

    ranked.push({
      cellKey: row.cellKey,
      descriptor,
      produced: row.produced,
      approved: row.approved,
      approvalRate: row.approved / row.produced,
    });
  }

  ranked.sort(
    (a, b) =>
      a.approvalRate - b.approvalRate || a.cellKey.localeCompare(b.cellKey),
  );

  return { ranked: ranked.slice(0, Math.max(opts.sample, 0)), skipped };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export type EvalGenExportArgs = {
  sample: number;
  out: string;
  language?: string;
  cefr?: string;
  allowProd: boolean;
};

/**
 * Fetch the grouped per-cell stats, rank the worst `--sample`, and return the
 * ranked cells + the cellKeys skipped as unparseable. Pure aside from the
 * injected `source` read; the CLI layers the JSON write on top.
 */
export async function runEvalGenExport(opts: {
  source: GenerationJobStatsSource;
  args: EvalGenExportArgs;
  log?: (...args: unknown[]) => void;
}): Promise<{ ranked: RankedCell[]; skipped: string[] }> {
  const { source, args, log = (...a: unknown[]) => console.log(...a) } = opts;

  const rows = await source.fetchCellApprovalRows();
  const { ranked, skipped } = rankFailureProneCells(rows, {
    sample: args.sample,
    language: args.language,
    cefr: args.cefr,
  });

  log(
    `[eval-gen-export] cells=${rows.length} ranked=${ranked.length} ` +
      `skipped=${skipped.length} (sample=${args.sample}` +
      `${args.language ? ` language=${args.language}` : ""}` +
      `${args.cefr ? ` cefr=${args.cefr}` : ""})`,
  );

  return { ranked, skipped };
}

/**
 * Write the ranked cells' descriptors as the JSON array the runner's
 * `loadCellDataset` consumes. Creates the parent directory if needed and
 * returns the absolute path written.
 */
export function writeCellDataset(
  ranked: readonly RankedCell[],
  outPath: string,
): string {
  const dir = path.dirname(outPath);
  mkdirSync(dir, { recursive: true });
  const descriptors = ranked.map((r) => r.descriptor);
  writeFileSync(outPath, JSON.stringify(descriptors, null, 2), "utf8");
  return path.resolve(outPath);
}

// ---------------------------------------------------------------------------
// argv parsing
// ---------------------------------------------------------------------------

export function parseEvalGenExportArgs(
  argv: string[] = process.argv.slice(2),
): EvalGenExportArgs {
  const parsed = parseArgs({
    args: argv,
    options: {
      sample: { type: "string" },
      out: { type: "string" },
      language: { type: "string" },
      cefr: { type: "string" },
      "allow-prod": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    printUsage();
    process.exit(0);
  }

  const missing: string[] = [];
  for (const key of ["sample", "out"] as const) {
    if (parsed.values[key] === undefined || parsed.values[key] === "") {
      missing.push(`--${key}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `[eval-gen-export] missing required argument(s): ${missing.join(", ")}`,
    );
  }

  const sample = Number(parsed.values.sample);
  if (!Number.isFinite(sample) || sample <= 0 || !Number.isInteger(sample)) {
    throw new Error(
      `[eval-gen-export] --sample must be a positive integer, got ${parsed.values.sample}`,
    );
  }

  return {
    sample,
    out: parsed.values.out!,
    language: parsed.values.language,
    cefr: parsed.values.cefr,
    allowProd: parsed.values["allow-prod"] ?? false,
  };
}

function printUsage(): void {
  console.log(
    [
      "Usage: pnpm eval:gen:export --sample <n> --out <path>",
      "                           [--language <code>] [--cefr <level>] [--allow-prod]",
      "",
      "Builds a failure-prone cell dataset for eval-gen-run by sampling the",
      "lowest-approval cells from generation_jobs (read-only). Writes a JSON",
      "array of cell descriptors to --out.",
      "",
      "  --sample <n>       Number of worst cells to include (failure-prone first).",
      "  --out <path>       Destination JSON file (parent dirs created).",
      "  --language <code>  Optional language filter — ES, DE, TR.",
      "  --cefr <level>     Optional CEFR filter — A1, A2, B1, B2.",
      "  --allow-prod       Required if LANGFUSE_ENV=prod (safety guard).",
      "  --help             Show this message.",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// CLI entry — only runs when invoked directly via `tsx scripts/eval-gen-export.ts`
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseEvalGenExportArgs();
  assertNotProdWithoutAllow(process.env.LANGFUSE_ENV, args.allowProd);

  // The Drizzle WebSocket pool is only created on the CLI path; tests inject a
  // `GenerationJobStatsSource` stub via `runEvalGenExport(opts)` directly.
  const db = createDb(requireEnv("DATABASE_URL"));
  const { ranked, skipped } = await runEvalGenExport({
    source: createGenerationJobStatsSource(db),
    args,
  });

  if (skipped.length > 0) {
    console.warn(
      `[eval-gen-export] skipped ${skipped.length} unparseable cellKey(s): ${skipped.join(", ")}`,
    );
  }

  if (ranked.length === 0) {
    console.error(
      "[eval-gen-export] no cells matched — nothing written (check filters / generation_jobs population)",
    );
    process.exit(1);
  }

  const outPath = writeCellDataset(ranked, args.out);
  console.log(
    `[eval-gen-export] wrote ${ranked.length} cell(s) to ${outPath} ` +
      `(approval ${(ranked[0].approvalRate * 100).toFixed(1)}%..` +
      `${(ranked[ranked.length - 1].approvalRate * 100).toFixed(1)}%)`,
  );
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error("[eval-gen-export] unhandled failure:", err);
    process.exit(1);
  });
}
