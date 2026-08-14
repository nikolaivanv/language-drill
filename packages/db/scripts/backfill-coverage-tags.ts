/**
 * `pnpm backfill:coverage-tags` — one-off CLI to tag the EXISTING approved pool
 * with realized coverage values (Pool Coverage Controller, Phase 0). New
 * generation is tagged at insert time; this backfills legacy rows.
 *
 * Replays the current validator over each approved row (`auto-approved` +
 * `manual-approved`) that needs tagging, reads `result.coverage`, applies the
 * cell-applicability rule (`applicableCoverageTags` from Task 5), and merges
 * the result into the column.
 *
 * Two selection modes:
 *   - default — rows whose `coverage_tags IS NULL`.
 *   - `--include-partial` — ALSO rows whose tags exist but lack an axis the
 *     point's `coverageSpec` declares. This is the case a `coverageSpec` axis
 *     added AFTER a cell was generated creates: every row is tagged, none
 *     carries the new key, and `audit:collapse` reports the axis as 0-realized
 *     even though the content may be fine. `IS NULL` alone never reaches them
 *     — the same blind spot as the `seedWord IS NULL` guard that made the #631
 *     variant backfill a no-op on 96% of its rows.
 *
 * Writes MERGE over existing tags (`mergeCoverageTags`), so re-tagging a
 * partially-tagged row can only add axes, never drop ones it already had.
 *
 * Scope: because polarity/sentenceType apply to all grammar cells (not only
 * personRotation ones), the default mode effectively covers the whole approved
 * grammar + vocab pool. Bound spend with --max-cost-usd and
 * --language/--cefr/--grammar-point/--type. The pass is resumable: a row that
 * has been tagged stops matching.
 *
 * Defaults to dry-run; pass --apply to write.
 *
 * Usage:
 *   pnpm backfill:coverage-tags
 *   pnpm backfill:coverage-tags --language TR --cefr A1
 *   pnpm backfill:coverage-tags --apply --max-cost-usd 5
 *   pnpm backfill:coverage-tags --limit 100 --concurrency 4
 *   pnpm backfill:coverage-tags --include-partial \
 *     --grammar-point es-a2-comparatives-superlatives --type cloze
 *
 * Required env: ANTHROPIC_API_KEY, DATABASE_URL.
 */

import { and, eq, inArray, isNull } from 'drizzle-orm';

import {
  ZERO_USAGE,
  addUsage,
  createClaudeClient,
  estimateCostUsd,
  validateDraft,
  type ClaudeUsageBreakdown,
  type ExerciseDraft,
  type GenerationSpec,
} from '@language-drill/ai';
import {
  CefrLevel,
  ExerciseType,
  Language,
  type CoverageSpec,
  type CoverageTags,
  type CurriculumCefrLevel,
  type ExerciseContent,
} from '@language-drill/shared';

import { createDb, type Db } from '../src/client';
import { getGrammarPoint } from '../src/curriculum';
import { exercises } from '../src/schema';
import { applicableCoverageTags } from '../src/generation/coverage-tags';
import { buildCellKey } from '../src/lib/cell-key';
import type { Cell } from '../src/generation/cells';

import { pLimit } from './p-limit';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_COST_USD = 5.0;

const LANGUAGE_VALUES = new Set(Object.values(Language));
const CEFR_VALUES = new Set(Object.values(CefrLevel));
const EXERCISE_TYPE_VALUES = new Set<string>(Object.values(ExerciseType));

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

export type BackfillArgs = {
  apply: boolean;
  language: Language | null;
  cefrLevel: CefrLevel | null;
  grammarPoint: string | null;
  exerciseType: string | null;
  /** Also consider rows whose tags exist but lack a spec-declared axis. */
  includePartial: boolean;
  limit: number | null;
  concurrency: number;
  maxCostUsd: number;
};

export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
  let apply = false;
  let language: Language | null = null;
  let cefrLevel: CefrLevel | null = null;
  let grammarPoint: string | null = null;
  let exerciseType: string | null = null;
  let includePartial = false;
  let limit: number | null = null;
  let concurrency = DEFAULT_CONCURRENCY;
  let maxCostUsd = DEFAULT_MAX_COST_USD;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      continue;
    } else if (arg === '--apply') {
      apply = true;
    } else if (arg === '--dry-run') {
      apply = false;
    } else if (arg === '--include-partial') {
      includePartial = true;
    } else if (arg === '--grammar-point') {
      const next = argv[++i];
      if (next === undefined) throw new Error('--grammar-point requires a value');
      grammarPoint = next;
    } else if (arg === '--type') {
      const next = argv[++i];
      if (next === undefined) throw new Error('--type requires a value');
      if (!EXERCISE_TYPE_VALUES.has(next)) {
        throw new Error(
          `--type: expected one of ${[...EXERCISE_TYPE_VALUES].join('|')}, got '${next}'`,
        );
      }
      exerciseType = next;
    } else if (arg === '--language' || arg === '--lang') {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      const upper = next.toUpperCase();
      if (!LANGUAGE_VALUES.has(upper as Language)) {
        throw new Error(
          `${arg}: expected one of ${[...LANGUAGE_VALUES].join('|')}, got '${next}'`,
        );
      }
      language = upper as Language;
    } else if (arg === '--cefr' || arg === '--level') {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      const upper = next.toUpperCase();
      if (!CEFR_VALUES.has(upper as CefrLevel)) {
        throw new Error(
          `${arg}: expected one of ${[...CEFR_VALUES].join('|')}, got '${next}'`,
        );
      }
      cefrLevel = upper as CefrLevel;
    } else if (arg === '--limit') {
      const next = argv[++i];
      if (next === undefined) throw new Error('--limit requires a value');
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--limit must be a positive integer, got ${next}`);
      }
      limit = parsed;
    } else if (arg === '--concurrency') {
      const next = argv[++i];
      if (next === undefined) throw new Error('--concurrency requires a value');
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--concurrency must be a positive integer, got ${next}`);
      }
      concurrency = parsed;
    } else if (arg === '--max-cost-usd') {
      const next = argv[++i];
      if (next === undefined) throw new Error('--max-cost-usd requires a value');
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--max-cost-usd must be a positive number, got ${next}`);
      }
      maxCostUsd = parsed;
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }

  return {
    apply,
    language,
    cefrLevel,
    grammarPoint,
    exerciseType,
    includePartial,
    limit,
    concurrency,
    maxCostUsd,
  };
}

// ---------------------------------------------------------------------------
// Row → draft / spec / cell reconstruction
// ---------------------------------------------------------------------------

export type CandidateRow = {
  id: string;
  type: string | null;
  language: string | null;
  difficulty: string | null;
  contentJson: unknown;
  grammarPointKey: string | null;
  topicDomain: string | null;
  modelId: string | null;
  coverageTags: CoverageTags | null;
};

/**
 * Spec-declared axes absent from a row's stored `coverage_tags`.
 *
 * Why spec axes only, and not everything `coverageAxesFor` monitors: the defect
 * this serves is a `coverageSpec` axis added to the curriculum AFTER a cell's
 * pool was generated, so every row predates it and no row carries the key —
 * `es-a2-comparatives-superlatives` has 50 rows tagged {polarity, sentenceType}
 * and zero carrying `comparison`, which the collapse audit then reports as
 * "0/14 comparative" when the content may be perfectly fine. The universal
 * monitoring axes (polarity/sentenceType) were always attempted, so their
 * absence usually means the validator genuinely could not determine one;
 * re-running would burn a call to reach the same answer. Including them would
 * also widen the sweep from a handful of cells to most of the pool.
 */
export function missingSpecAxes(
  stored: CoverageTags | null,
  spec: CoverageSpec | undefined,
): string[] {
  if (!spec) return [];
  const have = new Set(Object.keys(stored ?? {}));
  return spec.axes.map((a) => a.name).filter((name) => !have.has(name));
}

/**
 * Fresh tags layered over stored ones. Never narrows: an axis present in
 * `stored` but absent from `fresh` survives. Replacing outright would let a
 * single-axis repair delete the axes a row already had, which is data loss
 * dressed up as a backfill.
 */
export function mergeCoverageTags(
  stored: CoverageTags | null,
  fresh: CoverageTags,
): CoverageTags {
  return { ...(stored ?? {}), ...fresh };
}

export type Reconstructed =
  | { ok: true; draft: ExerciseDraft; spec: GenerationSpec; cell: Cell }
  | { ok: false; reason: string };

/**
 * Pure helper: take a DB row and produce the (draft, spec, cell) tuple that
 * `validateDraft` + `applicableCoverageTags` expect. Returns a structured
 * failure for rows the validator cannot meaningfully score.
 *
 * `draft.metadata.{inputTokens, outputTokens, ...}` are zeros because we are
 * not re-running generation; only the validator reads these fields and it
 * ignores them. `inBatchDuplicate=false` for the same reason.
 */
export function reconstructForValidation(row: CandidateRow): Reconstructed {
  if (!row.grammarPointKey) {
    return { ok: false, reason: 'no grammarPointKey (likely a seed row)' };
  }
  const grammarPoint = getGrammarPoint(row.grammarPointKey);
  if (!grammarPoint) {
    return { ok: false, reason: `unknown grammar point ${row.grammarPointKey}` };
  }

  if (!row.language || !LANGUAGE_VALUES.has(row.language as Language)) {
    return { ok: false, reason: `invalid language ${String(row.language)}` };
  }
  if (row.language === Language.EN) {
    return { ok: false, reason: 'EN is not a learner language' };
  }
  if (!row.difficulty || !CEFR_VALUES.has(row.difficulty as CefrLevel)) {
    return { ok: false, reason: `invalid difficulty ${String(row.difficulty)}` };
  }
  if (
    !row.type ||
    !EXERCISE_TYPE_VALUES.has(row.type)
  ) {
    return { ok: false, reason: `invalid exercise type ${String(row.type)}` };
  }

  const content = row.contentJson as { type?: unknown } | null;
  if (
    !content ||
    typeof content !== 'object' ||
    typeof content.type !== 'string' ||
    !EXERCISE_TYPE_VALUES.has(content.type)
  ) {
    return { ok: false, reason: 'malformed content_json' };
  }

  const language = row.language as Exclude<Language, Language.EN>;
  const cefrLevel = row.difficulty as CefrLevel;
  const exerciseType = content.type as ExerciseType;

  const draft: ExerciseDraft = {
    id: row.id,
    contentJson: content as ExerciseContent,
    metadata: {
      grammarPointKey: row.grammarPointKey,
      topicDomain: row.topicDomain,
      modelId: row.modelId ?? 'unknown',
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      inBatchDuplicate: false,
    },
  };
  const spec: GenerationSpec = {
    language,
    cefrLevel,
    exerciseType,
    grammarPoint,
    topicDomain: row.topicDomain,
    // `count` and `batchSeed` are unused by the validator; kept for type-completeness.
    count: 1,
    batchSeed: 'backfill',
  };
  const cell: Cell = {
    language,
    cefrLevel: cefrLevel as CurriculumCefrLevel,
    exerciseType,
    grammarPoint,
    cellKey: buildCellKey({
      language,
      cefrLevel,
      exerciseType,
      grammarPointKey: row.grammarPointKey,
    }),
  };
  return { ok: true, draft, spec, cell };
}

// ---------------------------------------------------------------------------
// DB I/O
// ---------------------------------------------------------------------------

async function fetchCandidates(db: Db, args: BackfillArgs): Promise<CandidateRow[]> {
  const filters = [inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved'])];
  // `coverage_tags IS NULL` is the ONLY selector without --include-partial, and
  // it silently skips every row whose tags exist but lack a declared axis — the
  // rows a late-added `coverageSpec` axis creates. Same shape as the
  // `seedWord IS NULL` guard that made the #631 variant backfill a no-op on 96%
  // of its intended rows.
  if (!args.includePartial) filters.push(isNull(exercises.coverageTags));
  if (args.language) filters.push(eq(exercises.language, args.language));
  if (args.cefrLevel) filters.push(eq(exercises.difficulty, args.cefrLevel));
  if (args.grammarPoint) filters.push(eq(exercises.grammarPointKey, args.grammarPoint));
  if (args.exerciseType) filters.push(eq(exercises.type, args.exerciseType));

  const query = db
    .select({
      id: exercises.id,
      type: exercises.type,
      language: exercises.language,
      difficulty: exercises.difficulty,
      contentJson: exercises.contentJson,
      grammarPointKey: exercises.grammarPointKey,
      topicDomain: exercises.topicDomain,
      modelId: exercises.modelId,
      coverageTags: exercises.coverageTags,
    })
    .from(exercises)
    .where(and(...filters))
    .orderBy(exercises.id);

  const rows = args.limit !== null ? await query.limit(args.limit) : await query;
  return rows as CandidateRow[];
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseBackfillArgs(process.argv.slice(2));

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  if (!anthropicKey) {
    console.error('ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }

  const db = createDb(databaseUrl);
  const client = createClaudeClient(anthropicKey);
  const limit = pLimit(args.concurrency);

  const fetched = await fetchCandidates(db, args);
  // With --include-partial the query also returns fully-tagged rows (it cannot
  // know each cell's declared axes in SQL), so drop those here. Rows with NULL
  // tags always qualify.
  const candidates = args.includePartial
    ? fetched.filter((row) => {
        if (row.coverageTags === null) return true;
        const point = row.grammarPointKey ? getGrammarPoint(row.grammarPointKey) : null;
        return missingSpecAxes(row.coverageTags, point?.coverageSpec).length > 0;
      })
    : fetched;
  console.log(
    `[backfill-coverage-tags] ${args.apply ? 'APPLY' : 'DRY-RUN'} — ${candidates.length} rows to tag` +
      (args.includePartial
        ? ` (${fetched.length} scanned; --include-partial: NULL tags + rows missing a spec axis)`
        : ' (untagged approved rows)'),
  );

  let usage: ClaudeUsageBreakdown = ZERO_USAGE;
  let written = 0;
  let skippedUnusable = 0;   // reconstructForValidation returned {ok:false}
  let skippedNoCoverage = 0; // applicableCoverageTags returned null
  let failed = 0;            // validateDraft threw (network/rate-limit/malformed response)
  const axisCounts: Record<string, number> = {};
  let stopped = false;

  await Promise.all(
    candidates.map((row) =>
      limit(async () => {
        if (stopped) return;

        const rec = reconstructForValidation(row);
        if (!rec.ok) {
          skippedUnusable++;
          return;
        }

        let result: Awaited<ReturnType<typeof validateDraft>>['result'];
        let tokenUsage: ClaudeUsageBreakdown;
        try {
          const r = await validateDraft(client, rec.draft, rec.spec);
          result = r.result;
          tokenUsage = r.tokenUsage;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[backfill-coverage-tags] row ${row.id} failed: ${message}`);
          failed++;
          return;
        }

        usage = addUsage(usage, tokenUsage);

        // Soft cap: up to (concurrency - 1) in-flight tasks may overshoot before
        // the flag is observed; the accumulated cost figure stays accurate.
        if (estimateCostUsd(usage) > args.maxCostUsd) {
          stopped = true;
          process.stderr.write(
            `\n[cost-cap] estimated cost ($${estimateCostUsd(usage).toFixed(4)}) > --max-cost-usd ($${args.maxCostUsd.toFixed(2)}); stopping new validator calls.\n`,
          );
        }

        const tags: CoverageTags | null = applicableCoverageTags(rec.cell, result.coverage);
        if (!tags) {
          skippedNoCoverage++;
          return;
        }

        for (const axis of Object.keys(tags)) {
          axisCounts[axis] = (axisCounts[axis] ?? 0) + 1;
        }

        // Merge over what is already stored rather than replacing it. A fresh
        // `applicableCoverageTags` is normally a superset, but if the validator
        // fails to determine one axis on this pass, a wholesale replace would
        // DELETE a good existing tag — turning a partial-tag repair into data
        // loss. Merging can only add or overwrite with a fresh reading.
        const merged = mergeCoverageTags(row.coverageTags, tags);
        if (args.apply) {
          await db.update(exercises).set({ coverageTags: merged }).where(eq(exercises.id, row.id));
        }
        written++;
      }),
    ),
  );

  console.log(
    `[backfill-coverage-tags] ${args.apply ? 'wrote' : 'would write'} ${written},` +
      ` skipped-unusable ${skippedUnusable}, skipped-no-coverage ${skippedNoCoverage},` +
      ` failed ${failed}` +
      (stopped ? ' (stopped at cost cap)' : ''),
  );
  console.log(`[backfill-coverage-tags] per-axis: ${JSON.stringify(axisCounts)}`);
  console.log(`[backfill-coverage-tags] est. cost: $${estimateCostUsd(usage).toFixed(4)}`);
}

// Skip auto-execution when this module is imported by tests.
const invokedDirectly = process.argv[1]
  ? import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url.endsWith(process.argv[1])
  : false;

if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
