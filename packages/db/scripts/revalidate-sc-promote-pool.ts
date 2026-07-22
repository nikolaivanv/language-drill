/**
 * `pnpm revalidate:sc-promote` — one-off CLI to recover falsely-flagged
 * `sentence_construction` (SC) exercises after the PR #606 validator fix.
 *
 * Background: the generation validator was applying the cloze single-answer
 * `ambiguous` rubric to SC, which is **open production** (many correct
 * sentences by design). Pool-wide that stranded ~80% of flagged SC drafts as
 * false positives — good exercises routed to `flagged` and never served
 * (serving filters on `auto-approved` / `manual-approved`). PR #606 scoped the
 * `ambiguous` dimension to SC + added an SC scoring note; #607 fixed the paired
 * `du`-as-subject generation bug. This script re-scores the already-stored
 * flagged SC drafts through the **corrected** validator and PROMOTES the ones
 * that now auto-approve. See `docs/analysis/generation-run-2026-07-22.md`.
 *
 * Promote-only policy — the mirror image of `revalidate:cloze`'s demote-only
 * policy (`decidePromotion` in `src/generation/revalidation.ts`):
 *
 *   current=flagged + new=auto-approved  → promote flagged → manual-approved
 *                                           (clear flagged_reasons)
 *   current=flagged + new=flagged         → no change (residual defect: stays
 *                                           flagged for human review)
 *   current=flagged + new=rejected        → no change (a promote pass NEVER
 *                                           lowers status; incl. #607 miscompiles)
 *   current=auto-approved / manual-approved / rejected → SKIPPED (not candidates)
 *
 * `manual-approved` (not `auto-approved`) records the operator remediation and
 * shields the row from the demote-only `revalidate:cloze` pass. As a side
 * effect, promoting these drafts lifts the affected SC cells back toward their
 * coverage target, which un-sticks the scheduler's `skip-low-yield`
 * suppression on cells whose last run approved < 3 drafts.
 *
 * Scope: `type = 'sentence_construction'`, `review_status = 'flagged'` only.
 * The promote policy is justified ONLY where a specific validator over-flag bug
 * was fixed — do NOT generalize this to other types without the same evidence.
 *
 * Defaults to dry-run; pass `--apply` to write. The fallback Langfuse path
 * (LANGFUSE_PUBLIC_KEY unset) returns the in-repo prompt template byte-for-
 * byte, so dry-running locally scores exactly as Lambda would in prod.
 *
 * Usage:
 *   pnpm revalidate:sc-promote                                 # dry-run, all flagged SC
 *   pnpm revalidate:sc-promote -- --language TR --cefr B1     # narrower
 *   pnpm revalidate:sc-promote -- --limit 20                  # bounded probe
 *   pnpm revalidate:sc-promote -- --apply --max-cost-usd 10   # write changes
 *
 * Required env: ANTHROPIC_API_KEY, DATABASE_URL.
 */

import { and, eq, inArray } from 'drizzle-orm';

import {
  ZERO_USAGE,
  addUsage,
  createClaudeClient,
  estimateCostUsd,
  validateDraft,
  type ClaudeUsageBreakdown,
  type ValidationResult,
} from '@language-drill/ai';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';

import { createDb, type Db } from '../src/client';
import { exercises } from '../src/schema';
import type { ReviewStatus } from '../src/generation/routing';
import {
  decidePromotion,
  reconstructDraftAndSpec,
  type CandidateRow,
  type PromotionAction,
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

export type PromoteArgs = {
  apply: boolean;
  language: Language | null;
  cefrLevel: CefrLevel | null;
  limit: number | null;
  concurrency: number;
  maxCostUsd: number;
};

const LANGUAGE_VALUES = new Set(Object.values(Language));
const CEFR_VALUES = new Set(Object.values(CefrLevel));

export function parsePromoteArgs(argv: readonly string[]): PromoteArgs {
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
// DB I/O
// ---------------------------------------------------------------------------

async function fetchCandidates(db: Db, args: PromoteArgs): Promise<CandidateRow[]> {
  const filters = [
    eq(exercises.type, ExerciseType.SENTENCE_CONSTRUCTION),
    // Only flagged rows are promote candidates. auto/manual-approved are
    // already served; rejected was a hard veto we do not resurrect.
    inArray(exercises.reviewStatus, ['flagged']),
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

async function applyPromotion(
  db: Db,
  rowId: string,
  qualityScore: number,
): Promise<void> {
  await db
    .update(exercises)
    .set({
      reviewStatus: 'manual-approved',
      // Mirror the admin approve path — a promoted row carries no flags.
      flaggedReasons: null,
      qualityScore,
    })
    .where(and(eq(exercises.id, rowId), eq(exercises.reviewStatus, 'flagged')));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

type Outcome =
  | { kind: 'no-change'; row: CandidateRow; result: ValidationResult }
  | { kind: 'promote'; row: CandidateRow; result: ValidationResult }
  | { kind: 'skip'; row: CandidateRow; reason: SkipReason | 'auto-approved' | 'manual-approved' | 'rejected'; detail?: string };

function printSummary(
  outcomes: readonly Outcome[],
  usage: ClaudeUsageBreakdown,
  args: PromoteArgs,
): void {
  const promoted = outcomes.filter((o) => o.kind === 'promote').length;
  const noChange = outcomes.filter((o) => o.kind === 'no-change').length;
  const skipped = outcomes.filter((o) => o.kind === 'skip').length;

  process.stdout.write('\n=== SC promote summary ===\n');
  process.stdout.write(`  rows scanned:            ${outcomes.length}\n`);
  process.stdout.write(`  promote → manual-approved: ${promoted}\n`);
  process.stdout.write(`  no change (stays flagged): ${noChange}\n`);
  process.stdout.write(`  skipped:                 ${skipped}\n`);
  process.stdout.write(
    `  tokens:                  input=${usage.inputTokens.toLocaleString()} ` +
      `cache_read=${usage.cacheReadInputTokens.toLocaleString()} ` +
      `cache_create=${usage.cacheCreationInputTokens.toLocaleString()} ` +
      `output=${usage.outputTokens.toLocaleString()}\n`,
  );
  process.stdout.write(`  estimated cost:          $${estimateCostUsd(usage).toFixed(4)}\n`);
  process.stdout.write(`  mode:                    ${args.apply ? 'APPLIED' : 'DRY-RUN (no writes)'}\n`);

  // Per-(language, level) promotion breakdown — where the recovery landed.
  if (promoted > 0) {
    const byCell = new Map<string, number>();
    for (const o of outcomes) {
      if (o.kind !== 'promote') continue;
      const cell = `${o.row.language}/${o.row.difficulty}`;
      byCell.set(cell, (byCell.get(cell) ?? 0) + 1);
    }
    process.stdout.write('\nPromotions by cell:\n');
    for (const [cell, count] of [...byCell.entries()].sort()) {
      process.stdout.write(`  ${cell.padEnd(8)}  ${count}\n`);
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
  const args = parsePromoteArgs(process.argv.slice(2));

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
    `Filters: type=sentence_construction review_status=flagged` +
      `${args.language ? ` language=${args.language}` : ''}` +
      `${args.cefrLevel ? ` cefr=${args.cefrLevel}` : ''}` +
      `${args.limit !== null ? ` limit=${args.limit}` : ''}\n`,
  );

  const candidates = await fetchCandidates(db, args);
  if (candidates.length === 0) {
    process.stdout.write('No matching rows.\n');
    return;
  }
  process.stdout.write(`Found ${candidates.length} flagged SC candidate rows.\n`);

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

        const recon = reconstructDraftAndSpec(row, ExerciseType.SENTENCE_CONSTRUCTION);
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

        const action: PromotionAction = decidePromotion(
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
          outcomes[idx] = { kind: 'no-change', row, result };
          return;
        }

        if (args.apply) {
          try {
            await applyPromotion(db, row.id, result.qualityScore);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[update-failed] ${row.id}: ${message}\n`);
            outcomes[idx] = {
              kind: 'skip',
              row,
              reason: 'malformed-content-json',
              detail: `update failed: ${message}`,
            };
            return;
          }
        }
        outcomes[idx] = { kind: 'promote', row, result };
      }),
    ),
  );

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
