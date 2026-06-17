/**
 * `pnpm revalidate:cloze` — one-off CLI to re-route already-stored cloze
 * exercises through the **current** validator (Phase 5 introduced two new
 * gates, `contextSpoilsAnswer` and the lexeme-set rewrite of `ambiguous`).
 * Existing rows in the pool were validated under the older prompt and may
 * still be visible to learners despite being ambiguous ("Sınıfta sekiz ___
 * var") or self-spoiling ("Vowel harmony: front vowel (e) requires -ler
 * suffix"). This script re-scores them and demotes the failures.
 *
 * Scope: `type = 'cloze'` across every (language, cefrLevel). Translation /
 * vocab_recall semantics were untouched by the prompt update, so they would
 * just burn tokens.
 *
 * Demote-only policy — the validator's verdict is allowed to LOWER review
 * status but never RAISE it:
 *
 *   current=auto-approved + new=auto-approved  → no change
 *   current=auto-approved + new=flagged         → write flagged + new reasons
 *   current=auto-approved + new=rejected        → write rejected + new reasons
 *   current=flagged       + new=rejected        → write rejected + new reasons
 *   current=flagged       + new=flagged         → no change (avoid churn)
 *   current=flagged       + new=auto-approved   → no change (never auto-promote)
 *   current=manual-approved                     → SKIPPED (humans decided)
 *   current=rejected                            → SKIPPED (already out)
 *
 * Rows whose `grammarPointKey` no longer resolves in the curriculum are
 * skipped with a logged reason — the validator needs the grammar point to
 * score `grammarPointMatch`.
 *
 * Defaults to dry-run; pass `--apply` to write. The fallback Langfuse path
 * (LANGFUSE_PUBLIC_KEY unset) returns the in-repo prompt template byte-for-
 * byte, so dry-running locally is safe and gives the exact same scoring
 * Lambda would in prod.
 *
 * Usage:
 *   pnpm revalidate:cloze                                 # dry-run, all cloze
 *   pnpm revalidate:cloze -- --language TR --cefr A1     # narrower
 *   pnpm revalidate:cloze -- --apply                     # write changes
 *   pnpm revalidate:cloze -- --limit 100 --concurrency 4 # bounded probe
 *   pnpm revalidate:cloze -- --apply --max-cost-usd 5
 *
 * Required env: ANTHROPIC_API_KEY, DATABASE_URL.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  ZERO_USAGE,
  addUsage,
  createClaudeClient,
  estimateCostUsd,
  validateDraft,
  type ClaudeUsageBreakdown,
  type ValidationResult,
} from '@language-drill/ai';
import {
  CefrLevel,
  ExerciseType,
  Language,
  formatReason,
} from '@language-drill/shared';

import { createDb, type Db } from '../src/client';
import { exercises } from '../src/schema';
import type { ReviewStatus } from '../src/generation/routing';
import {
  decideDemotion,
  reconstructDraftAndSpec,
  type CandidateRow,
  type DemotionAction,
  type SkipReason,
} from '../src/generation/revalidation';

import { pLimit } from './p-limit';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_COST_USD = 5.0;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

export type RevalidateArgs = {
  apply: boolean;
  language: Language | null;
  cefrLevel: CefrLevel | null;
  limit: number | null;
  concurrency: number;
  maxCostUsd: number;
};

const LANGUAGE_VALUES = new Set(Object.values(Language));
const CEFR_VALUES = new Set(Object.values(CefrLevel));

export function parseRevalidateArgs(argv: readonly string[]): RevalidateArgs {
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
        throw new Error(
          `--max-cost-usd must be a positive number, got ${next}`,
        );
      }
      maxCostUsd = parsed;
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }

  return { apply, language, cefrLevel, limit, concurrency, maxCostUsd };
}

// ---------------------------------------------------------------------------
// DB I/O
// ---------------------------------------------------------------------------

async function fetchCandidates(
  db: Db,
  args: RevalidateArgs,
): Promise<CandidateRow[]> {
  const filters = [
    eq(exercises.type, ExerciseType.CLOZE),
    inArray(exercises.reviewStatus, ['auto-approved', 'flagged']),
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
      reviewStatus: exercises.reviewStatus,
    })
    .from(exercises)
    .where(and(...filters))
    .orderBy(exercises.id);

  const rows = args.limit !== null ? await query.limit(args.limit) : await query;
  return rows as CandidateRow[];
}

async function applyDemotion(
  db: Db,
  rowId: string,
  action: Extract<DemotionAction, { kind: 'demote' }>,
  qualityScore: number,
): Promise<void> {
  await db
    .update(exercises)
    .set({
      reviewStatus: action.to,
      flaggedReasons: action.reasons,
      qualityScore,
    })
    .where(eq(exercises.id, rowId));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

type Outcome =
  | { kind: 'no-change'; row: CandidateRow }
  | { kind: 'demote'; row: CandidateRow; action: Extract<DemotionAction, { kind: 'demote' }>; result: ValidationResult }
  | { kind: 'skip'; row: CandidateRow; reason: SkipReason | 'manual-approved' | 'rejected'; detail?: string };

function printSummary(outcomes: readonly Outcome[], usage: ClaudeUsageBreakdown, args: RevalidateArgs): void {
  const noChange = outcomes.filter((o) => o.kind === 'no-change').length;
  const demoteToFlagged = outcomes.filter(
    (o) => o.kind === 'demote' && o.action.to === 'flagged',
  ).length;
  const demoteToRejected = outcomes.filter(
    (o) => o.kind === 'demote' && o.action.to === 'rejected',
  ).length;
  const skipped = outcomes.filter((o) => o.kind === 'skip').length;

  process.stdout.write('\n=== Revalidation summary ===\n');
  process.stdout.write(`  rows scanned:      ${outcomes.length}\n`);
  process.stdout.write(`  no change:         ${noChange}\n`);
  process.stdout.write(`  demote → flagged:  ${demoteToFlagged}\n`);
  process.stdout.write(`  demote → rejected: ${demoteToRejected}\n`);
  process.stdout.write(`  skipped:           ${skipped}\n`);
  process.stdout.write(
    `  tokens:            input=${usage.inputTokens.toLocaleString()} ` +
      `cache_read=${usage.cacheReadInputTokens.toLocaleString()} ` +
      `cache_create=${usage.cacheCreationInputTokens.toLocaleString()} ` +
      `output=${usage.outputTokens.toLocaleString()}\n`,
  );
  process.stdout.write(`  estimated cost:    $${estimateCostUsd(usage).toFixed(4)}\n`);
  process.stdout.write(`  mode:              ${args.apply ? 'APPLIED' : 'DRY-RUN (no writes)'}\n`);

  if (demoteToFlagged + demoteToRejected > 0) {
    process.stdout.write('\nDemotions:\n');
    for (const o of outcomes) {
      if (o.kind !== 'demote') continue;
      const reasons =
        o.action.reasons.length > 0
          ? o.action.reasons.map(formatReason).join('; ')
          : '(no reasons)';
      process.stdout.write(
        `  ${o.row.id}  ${o.row.language}/${o.row.difficulty}  ` +
          `${o.action.from} → ${o.action.to}  qs=${o.result.qualityScore.toFixed(2)}  ${reasons}\n`,
      );
    }
  }
  if (skipped > 0) {
    const skipReasons = new Map<string, number>();
    for (const o of outcomes) {
      if (o.kind !== 'skip') continue;
      skipReasons.set(o.reason, (skipReasons.get(o.reason) ?? 0) + 1);
    }
    process.stdout.write('\nSkip reasons:\n');
    for (const [reason, count] of skipReasons) {
      process.stdout.write(`  ${reason}: ${count}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseRevalidateArgs(process.argv.slice(2));

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
    `Filters: type=cloze` +
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
  const outcomes: Outcome[] = [];
  let costStopped = false;

  await Promise.all(
    candidates.map((row, idx) =>
      limit(async () => {
        if (costStopped) {
          outcomes[idx] = { kind: 'skip', row, reason: 'rejected', detail: 'cost-cap reached' };
          return;
        }

        const recon = reconstructDraftAndSpec(row, ExerciseType.CLOZE);
        if (!recon.ok) {
          outcomes[idx] = { kind: 'skip', row, reason: recon.reason, detail: recon.detail };
          return;
        }

        let result: ValidationResult;
        let callUsage: ClaudeUsageBreakdown;
        try {
          const r = await validateDraft(client, recon.draft, recon.spec);
          result = r.result;
          callUsage = r.tokenUsage;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          outcomes[idx] = {
            kind: 'skip',
            row,
            reason: 'malformed-content-json',
            detail: `validator threw: ${message}`,
          };
          return;
        }

        usage = addUsage(usage, callUsage);
        if (estimateCostUsd(usage) > args.maxCostUsd) {
          costStopped = true;
          process.stderr.write(
            `\n[cost-cap] estimated cost ($${estimateCostUsd(usage).toFixed(4)}) > --max-cost-usd ($${args.maxCostUsd.toFixed(2)}); stopping new validator calls.\n`,
          );
        }

        const action = decideDemotion(
          row.reviewStatus as ReviewStatus,
          result,
          recon.draft.contentJson,
          (row.language ?? undefined) as Language | undefined,
        );
        if (action.kind === 'skip') {
          outcomes[idx] = { kind: 'skip', row, reason: action.reason };
          return;
        }
        if (action.kind === 'no-change') {
          outcomes[idx] = { kind: 'no-change', row };
          return;
        }

        if (args.apply) {
          try {
            await applyDemotion(db, row.id, action, result.qualityScore);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(
              `[update-failed] ${row.id}: ${message}\n`,
            );
            outcomes[idx] = {
              kind: 'skip',
              row,
              reason: 'malformed-content-json',
              detail: `update failed: ${message}`,
            };
            return;
          }
        }
        outcomes[idx] = { kind: 'demote', row, action, result };
      }),
    ),
  );

  // Promise.all preserves order via the index map above; compact any sparse
  // entries (none expected — every branch writes outcomes[idx]).
  const compacted = outcomes.filter((o): o is Outcome => o !== undefined);
  printSummary(compacted, usage, args);
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
