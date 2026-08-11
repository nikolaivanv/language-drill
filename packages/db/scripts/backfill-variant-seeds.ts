/**
 * `pnpm backfill:variant-seeds` — one-off CLI labelling the approved
 * cloze/translation pool of the `constructionVariants` points with the variant
 * id each row actually realizes. Prerequisite for the PR #631 repass; see
 * docs/superpowers/specs/2026-08-11-variant-seed-backfill-design.md.
 *
 * Writes are keyed on the row's PRIMARY KEY — never on a content pattern. The
 * classifier decides, the dry run shows exactly which ids get which value, and
 * SQL only applies those decisions.
 *
 * Defaults to dry-run; `--apply` writes and additionally requires `--snapshot
 * <neon-branch-id>` or an explicit `--no-snapshot`.
 *
 * Usage:
 *   pnpm backfill:variant-seeds
 *   pnpm backfill:variant-seeds -- --language ES --grammar-point es-b1-que-vs-cual
 *   pnpm backfill:variant-seeds -- --apply --snapshot br-abc123
 *   pnpm backfill:variant-seeds -- --revert backfill-runs/run.json --apply
 *
 * Required env: ANTHROPIC_API_KEY, DATABASE_URL.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import type { GrammarPoint } from '@language-drill/shared';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  ZERO_USAGE,
  addUsage,
  classifyVariantSeeds,
  createClaudeClient,
  estimateCostUsd,
  type ClaudeUsageBreakdown,
  type ClassifierAssignment,
  type ClassifierConfidence,
  type ClassifierRow,
} from '@language-drill/ai';
import { createDb } from '../src/client';
import { getGrammarPoint } from '../src/curriculum';
import { exercises } from '../src/schema';
import { requireEnv } from '../src/lib/env';
import { pLimit } from './p-limit';

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_COST_USD = 5.0;

const LANGUAGE_VALUES = new Set<string>(Object.values(Language));
const CEFR_VALUES = new Set<string>(Object.values(CefrLevel));

/** Only these two types ever carry a construction-variant seed. */
const ELIGIBLE_TYPES = new Set<string>([ExerciseType.CLOZE, ExerciseType.TRANSLATION]);

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

export type BackfillArgs = {
  apply: boolean;
  /** Path to a prior run's artifact; restores each entry's oldSeedWord. */
  revertFrom: string | null;
  /** Neon branch id taken as a pre-apply snapshot; recorded in the artifact. */
  snapshot: string | null;
  language: Language | null;
  cefrLevel: CefrLevel | null;
  grammarPoint: string | null;
  minConfidence: 'high' | 'medium';
  limit: number | null;
  batchSize: number;
  concurrency: number;
  maxCostUsd: number;
  name: string;
};

export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
  let apply = false;
  let revertFrom: string | null = null;
  let snapshot: string | null = null;
  let noSnapshot = false;
  let language: Language | null = null;
  let cefrLevel: CefrLevel | null = null;
  let grammarPoint: string | null = null;
  let minConfidence: 'high' | 'medium' = 'high';
  let limit: number | null = null;
  let batchSize = DEFAULT_BATCH_SIZE;
  let concurrency = DEFAULT_CONCURRENCY;
  let maxCostUsd = DEFAULT_MAX_COST_USD;
  let name = 'backfill-variant-seeds';

  const need = (arg: string, next: string | undefined): string => {
    if (next === undefined) throw new Error(`${arg} requires a value`);
    return next;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // `pnpm run <script> -- --flag` forwards a bare `--`; the sibling db CLIs
    // all skip it, and CLAUDE.md documents that invocation style.
    if (arg === '--') continue;
    else if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') apply = false;
    else if (arg === '--no-snapshot') noSnapshot = true;
    else if (arg === '--snapshot') snapshot = need(arg, argv[++i]);
    else if (arg === '--revert') revertFrom = need(arg, argv[++i]);
    else if (arg === '--grammar-point') grammarPoint = need(arg, argv[++i]);
    else if (arg === '--name') name = need(arg, argv[++i]);
    else if (arg === '--language' || arg === '--lang') {
      const upper = need(arg, argv[++i]).toUpperCase();
      if (!LANGUAGE_VALUES.has(upper)) {
        throw new Error(`${arg}: expected one of ${[...LANGUAGE_VALUES].join('|')}, got '${upper}'`);
      }
      language = upper as Language;
    } else if (arg === '--cefr' || arg === '--level') {
      const upper = need(arg, argv[++i]).toUpperCase();
      if (!CEFR_VALUES.has(upper)) {
        throw new Error(`${arg}: expected one of ${[...CEFR_VALUES].join('|')}, got '${upper}'`);
      }
      cefrLevel = upper as CefrLevel;
    } else if (arg === '--min-confidence') {
      const v = need(arg, argv[++i]);
      // 'low' is deliberately not accepted: a low-confidence label is exactly
      // the wrong-label case this design treats as worse than no label.
      if (v !== 'high' && v !== 'medium') {
        throw new Error(`--min-confidence: expected high|medium, got '${v}'`);
      }
      minConfidence = v;
    } else if (arg === '--limit' || arg === '--batch-size' || arg === '--concurrency' || arg === '--max-cost-usd') {
      const parsed = Number(need(arg, argv[++i]));
      if (arg === '--max-cost-usd') {
        if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${arg} must be positive`);
        maxCostUsd = parsed;
      } else {
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error(`${arg} must be a positive integer, got '${parsed}'`);
        }
        if (arg === '--limit') limit = parsed;
        else if (arg === '--batch-size') batchSize = parsed;
        else concurrency = parsed;
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: backfill:variant-seeds [--language ES] [--cefr B1] [--grammar-point <key>]\n' +
          '       [--min-confidence high|medium] [--limit N] [--batch-size 20]\n' +
          '       [--concurrency 4] [--max-cost-usd 5] [--name <run>]\n' +
          '       [--apply --snapshot <neon-branch-id> | --apply --no-snapshot]\n' +
          '       [--revert <artifact.json> --apply]',
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument '${arg}'`);
    }
  }

  // The forcing function: an --apply run must name its rollback snapshot or
  // explicitly disclaim one. Reverting is exempt — the undo path must not have
  // friction at the moment you need it.
  if (apply && revertFrom === null && snapshot === null && !noSnapshot) {
    throw new Error(
      '--apply requires --snapshot <neon-branch-id> (take a Neon branch off the target first) ' +
        'or an explicit --no-snapshot',
    );
  }

  return {
    apply, revertFrom, snapshot, language, cefrLevel, grammarPoint,
    minConfidence, limit, batchSize, concurrency, maxCostUsd, name,
  };
}

// ---------------------------------------------------------------------------
// Row selection
// ---------------------------------------------------------------------------

export type CandidateRow = {
  id: string;
  grammarPointKey: string;
  type: ExerciseType;
  language: string;
  difficulty: string;
  contentJson: Record<string, unknown>;
};

/**
 * Whether this row should be classified at all. Three independent guards:
 * the point must declare variants, the type must be one that carries a variant
 * seed, and the row must not already be correctly labelled (which makes the
 * pass resumable and leaves the ~331 already-correct rows alone).
 */
export function isEligible(gp: GrammarPoint, row: CandidateRow): boolean {
  const variants = gp.constructionVariants;
  if (!variants || variants.length === 0) return false;
  if (!ELIGIBLE_TYPES.has(row.type)) return false;

  const current = row.contentJson.seedWord;
  if (typeof current === 'string' && variants.some((v) => v.id === current)) return false;

  return true;
}

/**
 * The learner-visible content the classifier judges. Returns null when the row
 * lacks a usable field — sending empty text would invite a confident guess from
 * no evidence.
 */
export function toClassifierRow(row: CandidateRow): ClassifierRow | null {
  const c = row.contentJson;
  if (row.type === ExerciseType.CLOZE) {
    const prompt = c.sentence;
    const answer = c.correctAnswer;
    if (typeof prompt !== 'string' || typeof answer !== 'string') return null;
    return { rowId: row.id, prompt, answer };
  }
  if (row.type === ExerciseType.TRANSLATION) {
    const prompt = c.sourceText;
    const answer = c.referenceTranslation;
    if (typeof prompt !== 'string' || typeof answer !== 'string') return null;
    return { rowId: row.id, prompt, answer };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------

/** One row's change. `oldSeedWord` is what makes `--revert` possible. */
export type ArtifactEntry = {
  id: string;
  cellKey: string;
  oldSeedWord: string | null;
  newSeedWord: string;
  confidence: ClassifierConfidence;
};

export type Artifact = {
  name: string;
  createdAtIso: string;
  /** True only when every entry's write succeeded — false on a partial apply. */
  applied: boolean;
  /**
   * How many entries were actually written before either finishing or hitting
   * a failure. 0 for an unapplied (dry-run) artifact. Distinct from
   * `entries.length`, which is the full candidate set regardless of outcome.
   */
  appliedCount: number;
  snapshotBranchId: string | null;
  minConfidence: 'high' | 'medium';
  entries: ArtifactEntry[];
};

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

const CONFIDENCE_RANK: Record<ClassifierConfidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Turn classifier assignments into the concrete writes for one cell.
 *
 * A null `variantId` never produces a write regardless of confidence — the
 * model saying "confidently, none of these" is still a decision not to label.
 */
export function selectWrites(
  rows: readonly CandidateRow[],
  assignments: readonly ClassifierAssignment[],
  minConfidence: 'high' | 'medium',
  cellKey: string,
): ArtifactEntry[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const floor = CONFIDENCE_RANK[minConfidence];
  const out: ArtifactEntry[] = [];

  for (const a of assignments) {
    if (a.variantId === null) continue;
    if (CONFIDENCE_RANK[a.confidence] < floor) continue;
    const row = byId.get(a.rowId);
    if (!row) continue;
    const old = row.contentJson.seedWord;
    out.push({
      id: row.id,
      cellKey,
      oldSeedWord: typeof old === 'string' ? old : null,
      newSeedWord: a.variantId,
      confidence: a.confidence,
    });
  }
  return out;
}

/** Human-readable per-cell, per-variant breakdown for the dry-run output. */
export function summarize(entries: readonly ArtifactEntry[]): string {
  if (entries.length === 0) return 'no rows would change';
  const byCell = new Map<string, Map<string, number>>();
  for (const e of entries) {
    let cell = byCell.get(e.cellKey);
    if (!cell) { cell = new Map(); byCell.set(e.cellKey, cell); }
    cell.set(e.newSeedWord, (cell.get(e.newSeedWord) ?? 0) + 1);
  }
  const lines: string[] = [];
  for (const [cellKey, variants] of [...byCell.entries()].sort()) {
    lines.push(`  ${cellKey}`);
    for (const [variantId, n] of [...variants.entries()].sort()) {
      lines.push(`    ${variantId}: ${n}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function artifactPath(name: string): string {
  const dir = path.join(process.cwd(), 'backfill-runs');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.json`);
}

/**
 * Convert the SDK's snake_case usage block into the camelCase breakdown
 * `addUsage`/`estimateCostUsd` expect. Mirrors `readUsage` in qa-sample.ts /
 * generate.ts — `classifyVariantSeeds` returns the raw `Anthropic.Usage`
 * shape, not `ClaudeUsageBreakdown`, so this conversion is required rather
 * than a passthrough.
 */
function readUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
}): ClaudeUsageBreakdown {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  };
}

/** Apply one entry. Keyed on the PRIMARY KEY; nothing is content-matched. */
async function writeSeed(
  db: ReturnType<typeof createDb>,
  id: string,
  seedWord: string | null,
): Promise<void> {
  await db
    .update(exercises)
    .set({
      contentJson:
        seedWord === null
          ? sql`content_json - 'seedWord'`
          : sql`jsonb_set(content_json, '{seedWord}', to_jsonb(${seedWord}::text))`,
    })
    .where(eq(exercises.id, id));
}

export type ApplyResult = { appliedCount: number; failure: string | null };

/**
 * Apply each entry's write in order, stopping at the first failure rather
 * than pressing on into what may be a persistent fault. Returns how many
 * writes succeeded before either finishing or failing, so the caller can
 * report a partial apply accurately instead of guessing from a thrown error.
 */
export async function applyWrites(
  entries: readonly ArtifactEntry[],
  write: (id: string, seedWord: string | null) => Promise<void>,
): Promise<ApplyResult> {
  let appliedCount = 0;
  for (const e of entries) {
    try {
      await write(e.id, e.newSeedWord);
      appliedCount++;
    } catch (err) {
      return { appliedCount, failure: err instanceof Error ? err.message : String(err) };
    }
  }
  return { appliedCount, failure: null };
}

/**
 * Persist the artifact BEFORE any row is touched — so the fine-grained
 * revert source exists even if the process dies mid-apply — then run the
 * writes fail-fast, then persist the final `applied`/`appliedCount` state.
 * Without the first persist, a crash after row 150 of 300 leaves 150 rows
 * changed with no artifact to revert them from; the Neon snapshot is still
 * there as a coarse fallback, but the design promises two independent
 * undo paths, not one.
 *
 * `write` and `persist` are injected so this orchestration is unit-testable
 * without a real DB connection or filesystem.
 */
export async function applyAndPersist(
  artifact: Artifact,
  write: (id: string, seedWord: string | null) => Promise<void>,
  persist: (artifact: Artifact) => void,
): Promise<ApplyResult> {
  persist(artifact);
  const result = await applyWrites(artifact.entries, write);
  persist({ ...artifact, applied: result.failure === null, appliedCount: result.appliedCount });
  return result;
}

async function runRevert(args: BackfillArgs): Promise<void> {
  const artifact = JSON.parse(readFileSync(args.revertFrom!, 'utf8')) as Artifact;
  console.log(`[backfill-variant-seeds] revert: ${artifact.entries.length} entries from ${args.revertFrom}`);
  if (!args.apply) {
    console.log('[backfill-variant-seeds] dry-run: pass --apply to restore. Sample:');
    for (const e of artifact.entries.slice(0, 5)) {
      console.log(`  ${e.id}: ${e.newSeedWord} -> ${e.oldSeedWord ?? '(removed)'}`);
    }
    return;
  }
  const db = createDb(requireEnv('DATABASE_URL'));
  for (const e of artifact.entries) await writeSeed(db, e.id, e.oldSeedWord);
  console.log(`[backfill-variant-seeds] restored ${artifact.entries.length} rows.`);
}

async function main(): Promise<void> {
  const args = parseBackfillArgs(process.argv.slice(2));
  if (args.revertFrom !== null) return runRevert(args);

  const db = createDb(requireEnv('DATABASE_URL'));

  const conditions = [
    inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
    inArray(exercises.type, [...ELIGIBLE_TYPES]),
    isNotNull(exercises.grammarPointKey),
  ];
  if (args.language) conditions.push(sql`${exercises.language} = ${args.language}`);
  if (args.cefrLevel) conditions.push(sql`${exercises.difficulty} = ${args.cefrLevel}`);
  if (args.grammarPoint) conditions.push(sql`${exercises.grammarPointKey} = ${args.grammarPoint}`);

  const raw = await db
    .select({
      id: exercises.id,
      grammarPointKey: exercises.grammarPointKey,
      type: exercises.type,
      language: exercises.language,
      difficulty: exercises.difficulty,
      contentJson: exercises.contentJson,
    })
    .from(exercises)
    .where(and(...conditions));

  // Group eligible rows per cell; the classifier's system block is per-point.
  const cells = new Map<string, { gp: GrammarPoint; rows: CandidateRow[] }>();
  for (const r of raw) {
    const gp = r.grammarPointKey ? getGrammarPoint(r.grammarPointKey) : undefined;
    if (!gp) continue;
    const row: CandidateRow = {
      id: r.id,
      grammarPointKey: r.grammarPointKey!,
      type: r.type as ExerciseType,
      language: r.language!,
      difficulty: r.difficulty!,
      contentJson: (r.contentJson ?? {}) as Record<string, unknown>,
    };
    if (!isEligible(gp, row)) continue;
    // Display-only grouping key for the artifact and printed summary — NOT
    // the canonical `buildCellKey`/`generation_jobs.cell_key` format (that
    // one lowercases language/level; this keeps the DB's stored casing). It
    // is never joined against `generation_jobs`, so the case mismatch is
    // harmless; don't "fix" it to match `buildCellKey` without checking
    // every consumer of the artifact JSON first.
    const cellKey = `${row.language}:${row.difficulty}:${row.type}:${row.grammarPointKey}`;
    let cell = cells.get(cellKey);
    if (!cell) { cell = { gp, rows: [] }; cells.set(cellKey, cell); }
    cell.rows.push(row);
  }

  let cellList = [...cells.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (args.limit !== null) cellList = cellList.slice(0, args.limit);
  console.log(`[backfill-variant-seeds] ${raw.length} rows scanned -> ${cellList.length} cells with eligible rows`);

  const client = createClaudeClient(requireEnv('ANTHROPIC_API_KEY'));
  const limit = pLimit(args.concurrency);
  let usage: ClaudeUsageBreakdown = ZERO_USAGE;
  const entries: ArtifactEntry[] = [];
  const failures: string[] = [];

  for (const [cellKey, cell] of cellList) {
    const batches: CandidateRow[][] = [];
    for (let i = 0; i < cell.rows.length; i += args.batchSize) {
      batches.push(cell.rows.slice(i, i + args.batchSize));
    }
    const results = await Promise.all(
      batches.map((batch) =>
        limit(async () => {
          if (estimateCostUsd(usage) >= args.maxCostUsd) {
            // Never truncate silently — a skipped batch is reported, not dropped.
            //
            // This is a soft, racy cap, not a hard ceiling: `usage` is read
            // synchronously before this batch's first await, and `pLimit`
            // dispatches up to `concurrency` batches synchronously, so up to
            // `concurrency - 1` batches can already be in flight — reading
            // the same stale `usage` — before any of them updates it. The
            // post-run check below turns any resulting overshoot into a
            // visible warning instead of a silently-blown budget. Do not
            // "fix" this by serializing dispatch — the same pattern exists
            // in revalidate-cloze-pool.ts and the tradeoff is intentional.
            failures.push(`${cellKey}: skipped, hit --max-cost-usd ${args.maxCostUsd}`);
            return [] as ArtifactEntry[];
          }
          const classifierRows = batch.map(toClassifierRow).filter((r): r is ClassifierRow => r !== null);
          if (classifierRows.length === 0) return [] as ArtifactEntry[];
          try {
            const res = await classifyVariantSeeds(client, cell.gp, classifierRows);
            usage = addUsage(usage, readUsage(res.usage));
            return selectWrites(batch, res.assignments, args.minConfidence, cellKey);
          } catch (err) {
            failures.push(`${cellKey}: ${err instanceof Error ? err.message : String(err)}`);
            return [] as ArtifactEntry[];
          }
        }),
      ),
    );
    for (const r of results) entries.push(...r);
  }

  const artifact: Artifact = {
    name: args.name,
    createdAtIso: new Date().toISOString(),
    applied: false,
    appliedCount: 0,
    snapshotBranchId: args.snapshot,
    minConfidence: args.minConfidence,
    entries,
  };

  console.log(`\n[backfill-variant-seeds] ${entries.length} rows would be labelled:\n${summarize(entries)}`);
  if (failures.length > 0) {
    console.log(`\n[backfill-variant-seeds] ${failures.length} batch failures:`);
    for (const f of failures) console.log(`  ${f}`);
  }
  const finalCostUsd = estimateCostUsd(usage);
  console.log(`\n[backfill-variant-seeds] estimated cost $${finalCostUsd.toFixed(2)}`);
  if (finalCostUsd > args.maxCostUsd) {
    // See the comment at the cost-guard check above: this is the visible
    // side of a known, accepted race — a bounded overshoot, not silent.
    console.warn(
      `[backfill-variant-seeds] WARNING: estimated cost $${finalCostUsd.toFixed(2)} exceeded ` +
        `--max-cost-usd $${args.maxCostUsd.toFixed(2)} by $${(finalCostUsd - args.maxCostUsd).toFixed(2)} — ` +
        `up to ${Math.max(args.concurrency - 1, 0)} batches can start before an in-flight batch updates the running total.`,
    );
  }

  const out = artifactPath(args.name);
  const persist = (a: Artifact): void => {
    writeFileSync(out, JSON.stringify(a, null, 2), 'utf8');
    console.log(`[backfill-variant-seeds] artifact written to ${out}`);
  };

  if (args.apply) {
    // `applyAndPersist` writes the artifact BEFORE touching any row, so a
    // crash partway through still leaves a revert source on disk.
    const result = await applyAndPersist(artifact, (id, seedWord) => writeSeed(db, id, seedWord), persist);
    if (result.failure === null) {
      console.log(`[backfill-variant-seeds] APPLIED ${result.appliedCount} rows.`);
      console.log('[backfill-variant-seeds] Re-run `pnpm audit:collapse --dry-run` and confirm unrecognizedSeedCount fell.');
    } else {
      console.error(
        `[backfill-variant-seeds] STOPPED after ${result.appliedCount}/${entries.length} rows — write failed: ${result.failure}`,
      );
      console.error(
        `[backfill-variant-seeds] the artifact at ${out} reflects only the ${result.appliedCount} rows actually ` +
          `written; revert them with --revert ${out} --apply once the fault is understood.`,
      );
    }
  } else {
    persist(artifact);
    console.log('[backfill-variant-seeds] dry-run: nothing written. Pass --apply --snapshot <branch> to write.');
  }
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error('[backfill-variant-seeds] unhandled failure:', err);
    process.exit(1);
  });
}
