/**
 * `pnpm backfill:conjugation` — one-off CLI that enriches conjugation exercises
 * predating PR #386 with the structured display fields (`features[]` +
 * `subject`). It does NOT generate new exercises: for each flat row it derives
 * the two fields from the row's own `(lemma, lemmaGloss, featureBundle,
 * targetForm)` via the in-repo `deriveConjugationStructure` helper, then merges
 * them into `content_json` in place — preserving the row id (and therefore all
 * practice history + spaced-repetition state) and the `_dedupKey`.
 *
 * Why backfill rather than regenerate: the conjugation dedup key is
 * `lemma + featureBundle`, so the existing approved rows occupy the avoid-list
 * and block fresh structured drafts on the same surfaces; and FK references from
 * `user_exercise_history` forbid deleting practiced rows. Enriching in place
 * sidesteps both and is lossless.
 *
 * Scope: `type = 'conjugation'` rows lacking `features`, across non-`rejected`
 * statuses. Defaults to dry-run; pass `--apply` to write.
 *
 * Usage:
 *   pnpm backfill:conjugation                                  # dry-run, all
 *   pnpm backfill:conjugation -- --lang TR --level A1          # narrower
 *   pnpm backfill:conjugation -- --limit 5                     # bounded preview
 *   pnpm backfill:conjugation -- --apply --max-cost-usd 3
 *
 * Required env: ANTHROPIC_API_KEY, DATABASE_URL.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  ZERO_USAGE,
  addUsage,
  createClaudeClient,
  estimateCostUsd,
  deriveConjugationStructure,
  type ClaudeUsageBreakdown,
  type ConjugationCellDescriptor,
  type ConjugationStructure,
} from '@language-drill/ai';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';

import { createDb, type Db } from '../src/client';
import { exercises } from '../src/schema';

import { pLimit } from './p-limit';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_COST_USD = 5.0;

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

const LANGUAGE_VALUES = new Set<string>(Object.values(Language));
const CEFR_VALUES = new Set<string>(Object.values(CefrLevel));

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
      if (!LANGUAGE_VALUES.has(upper)) {
        throw new Error(`${arg}: expected one of ${[...LANGUAGE_VALUES].join('|')}, got '${next}'`);
      }
      language = upper as Language;
    } else if (arg === '--cefr' || arg === '--level') {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      const upper = next.toUpperCase();
      if (!CEFR_VALUES.has(upper)) {
        throw new Error(`${arg}: expected one of ${[...CEFR_VALUES].join('|')}, got '${next}'`);
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
// Pure helpers
// ---------------------------------------------------------------------------

export type DescriptorResult =
  | { ok: true; cell: ConjugationCellDescriptor }
  | { ok: false; reason: 'already-structured' | 'not-object' | 'missing-fields' };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Build the LLM cell descriptor from a row's `content_json`, or report why the
 * row is skipped. Rows that already carry `features` are left untouched
 * (idempotent re-runs).
 */
export function extractCellDescriptor(
  contentJson: unknown,
  language: string,
): DescriptorResult {
  if (!isObject(contentJson)) return { ok: false, reason: 'not-object' };
  if ('features' in contentJson && contentJson.features !== undefined) {
    return { ok: false, reason: 'already-structured' };
  }
  const { lemma, lemmaGloss, featureBundle, targetForm } = contentJson;
  if (
    !nonEmptyString(lemma) ||
    !nonEmptyString(lemmaGloss) ||
    !nonEmptyString(featureBundle) ||
    !nonEmptyString(targetForm)
  ) {
    return { ok: false, reason: 'missing-fields' };
  }
  return {
    ok: true,
    cell: { language, lemma, lemmaGloss, featureBundle, targetForm },
  };
}

// ---------------------------------------------------------------------------
// DB I/O
// ---------------------------------------------------------------------------

type CandidateRow = {
  id: string;
  language: Language | null;
  difficulty: CefrLevel;
  contentJson: unknown;
};

async function fetchCandidates(db: Db, args: BackfillArgs): Promise<CandidateRow[]> {
  const filters = [
    eq(exercises.type, ExerciseType.CONJUGATION),
    inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved', 'flagged']),
    // Only rows still missing the structured field. `?` is the jsonb
    // key-existence operator; NOT (... ? 'features') keeps it idempotent.
    sql`NOT (${exercises.contentJson} ? 'features')`,
  ];
  if (args.language) filters.push(eq(exercises.language, args.language));
  if (args.cefrLevel) filters.push(eq(exercises.difficulty, args.cefrLevel));

  const query = db
    .select({
      id: exercises.id,
      language: exercises.language,
      difficulty: exercises.difficulty,
      contentJson: exercises.contentJson,
    })
    .from(exercises)
    .where(and(...filters))
    .orderBy(exercises.id);

  const rows = args.limit !== null ? await query.limit(args.limit) : await query;
  return rows as CandidateRow[];
}

/** Merge the two derived fields into content_json without touching anything else. */
async function applyStructure(
  db: Db,
  rowId: string,
  structure: ConjugationStructure,
): Promise<void> {
  await db
    .update(exercises)
    .set({
      contentJson: sql`${exercises.contentJson} || ${JSON.stringify(structure)}::jsonb`,
    })
    .where(eq(exercises.id, rowId));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

type Outcome =
  | { kind: 'filled'; row: CandidateRow; structure: ConjugationStructure }
  | { kind: 'skip'; row: CandidateRow; reason: string };

function printSummary(outcomes: readonly Outcome[], usage: ClaudeUsageBreakdown, args: BackfillArgs): void {
  const filled = outcomes.filter((o) => o.kind === 'filled');
  const skipped = outcomes.filter((o) => o.kind === 'skip');

  process.stdout.write('\n=== Conjugation backfill summary ===\n');
  process.stdout.write(`  rows scanned:  ${outcomes.length}\n`);
  process.stdout.write(`  enriched:      ${filled.length}\n`);
  process.stdout.write(`  skipped:       ${skipped.length}\n`);
  process.stdout.write(`  estimated cost: $${estimateCostUsd(usage).toFixed(4)}\n`);
  process.stdout.write(`  mode:          ${args.apply ? 'APPLIED' : 'DRY-RUN (no writes)'}\n`);

  // Preview a few derived structures so a dry-run is inspectable.
  const preview = filled.slice(0, 8);
  if (preview.length > 0) {
    process.stdout.write('\nDerived (sample):\n');
    for (const o of preview) {
      if (o.kind !== 'filled') continue;
      const feats = o.structure.features.map((f) => `${f.term} (${f.gloss})`).join(' · ');
      const subj = o.structure.subject
        ? `${o.structure.subject.pronoun} (${o.structure.subject.gloss})`
        : '(none)';
      process.stdout.write(
        `  ${o.row.id}  ${o.row.language}/${o.row.difficulty}  ` +
          `subject=${subj}  features=${feats}\n`,
      );
    }
  }
  if (skipped.length > 0) {
    const reasons = new Map<string, number>();
    for (const o of outcomes) {
      if (o.kind !== 'skip') continue;
      reasons.set(o.reason, (reasons.get(o.reason) ?? 0) + 1);
    }
    process.stdout.write('\nSkip reasons:\n');
    for (const [reason, count] of reasons) process.stdout.write(`  ${reason}: ${count}\n`);
  }
}

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

  process.stdout.write(
    `Filters: type=conjugation missing-features` +
      `${args.language ? ` language=${args.language}` : ''}` +
      `${args.cefrLevel ? ` cefr=${args.cefrLevel}` : ''}` +
      `${args.limit !== null ? ` limit=${args.limit}` : ''}\n`,
  );

  const candidates = await fetchCandidates(db, args);
  if (candidates.length === 0) {
    process.stdout.write('No matching rows.\n');
    return;
  }
  process.stdout.write(`Found ${candidates.length} candidate rows.\n`);

  const limit = pLimit(args.concurrency);
  let usage: ClaudeUsageBreakdown = ZERO_USAGE;
  let costStopped = false;
  const outcomes: Outcome[] = [];

  await Promise.all(
    candidates.map((row, idx) =>
      limit(async () => {
        if (costStopped) {
          outcomes[idx] = { kind: 'skip', row, reason: 'cost-cap reached' };
          return;
        }

        const desc = extractCellDescriptor(row.contentJson, (row.language ?? '') as string);
        if (!desc.ok) {
          outcomes[idx] = { kind: 'skip', row, reason: desc.reason };
          return;
        }

        let structure: ConjugationStructure;
        try {
          const r = await deriveConjugationStructure(client, desc.cell);
          structure = r.structure;
          usage = addUsage(usage, r.tokenUsage);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          outcomes[idx] = { kind: 'skip', row, reason: `derive-failed: ${message}` };
          return;
        }

        if (estimateCostUsd(usage) > args.maxCostUsd) {
          costStopped = true;
          process.stderr.write(
            `\n[cost-cap] estimated cost ($${estimateCostUsd(usage).toFixed(4)}) > --max-cost-usd ($${args.maxCostUsd.toFixed(2)}); stopping new calls.\n`,
          );
        }

        if (args.apply) {
          try {
            await applyStructure(db, row.id, structure);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[update-failed] ${row.id}: ${message}\n`);
            outcomes[idx] = { kind: 'skip', row, reason: `update-failed: ${message}` };
            return;
          }
        }
        outcomes[idx] = { kind: 'filled', row, structure };
      }),
    ),
  );

  printSummary(
    outcomes.filter((o): o is Outcome => o !== undefined),
    usage,
    args,
  );
}

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
