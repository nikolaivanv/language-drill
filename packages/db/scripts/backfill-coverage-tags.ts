/**
 * `pnpm backfill:coverage-tags` — one-off CLI to tag the EXISTING approved pool
 * with realized coverage values (Pool Coverage Controller, Phase 0). New
 * generation is tagged at insert time; this backfills legacy rows.
 *
 * Replays the current validator over each approved row (`auto-approved` +
 * `manual-approved`) whose `coverage_tags IS NULL`, reads `result.coverage`,
 * applies the cell-applicability rule (`applicableCoverageTags` from Task 5),
 * and writes the column.
 *
 * Scope: because polarity/sentenceType apply to all grammar cells (not only
 * personRotation ones), this effectively covers the whole approved grammar +
 * vocab pool. Bound spend with --max-cost-usd and --language/--cefr. The pass
 * is resumable: it only touches rows with coverage_tags IS NULL.
 *
 * Defaults to dry-run; pass --apply to write.
 *
 * Usage:
 *   pnpm backfill:coverage-tags
 *   pnpm backfill:coverage-tags -- --language TR --cefr A1
 *   pnpm backfill:coverage-tags -- --apply --max-cost-usd 5
 *   pnpm backfill:coverage-tags -- --limit 100 --concurrency 4
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
  limit: number | null;
  concurrency: number;
  maxCostUsd: number;
};

export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
  let apply = false;
  let language: Language | null = null;
  let cefrLevel: CefrLevel | null = null;
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

  return { apply, language, cefrLevel, limit, concurrency, maxCostUsd };
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
};

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
  const filters = [
    inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
    isNull(exercises.coverageTags),
  ];
  if (args.language) filters.push(eq(exercises.language, args.language));
  if (args.cefrLevel) filters.push(eq(exercises.difficulty, args.cefrLevel));

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

  const candidates = await fetchCandidates(db, args);
  console.log(
    `[backfill-coverage-tags] ${args.apply ? 'APPLY' : 'DRY-RUN'} — ${candidates.length} untagged approved rows`,
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

        if (args.apply) {
          await db.update(exercises).set({ coverageTags: tags }).where(eq(exercises.id, row.id));
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
