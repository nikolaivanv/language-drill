/**
 * `pnpm revalidate:promote` — one-off CLI to recover falsely-flagged exercises
 * after a validator over-flag bug has been fixed.
 *
 * Originally `revalidate:sc-promote`, scoped to `sentence_construction` for the
 * PR #606 recovery: the generation validator was applying the cloze
 * single-answer `ambiguous` rubric to SC, which is **open production** (many
 * correct sentences by design). Pool-wide that stranded ~80% of flagged SC
 * drafts as false positives — good exercises routed to `flagged` and never
 * served (serving filters on `auto-approved` / `manual-approved`). PR #606
 * scoped the `ambiguous` dimension to SC + added an SC scoring note; #607 fixed
 * the paired `du`-as-subject generation bug. See
 * `docs/analysis/generation-run-2026-07-22.md`.
 *
 * Generalized 2026-08-18 for the `es-b1-reported-speech` recovery: PR #664 gave
 * the point two new `constructionVariants`, but its `name` still read "Reported
 * speech (present-to-past)" and the validator reasons from that string — so 20
 * of 20 correct on-variant translations were flagged `grammar-point-mismatch`
 * the first night they were generated. See
 * `docs/analysis/generation-run-2026-08-18.md`.
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
 * effect, promoting these drafts lifts the affected cells back toward their
 * coverage target, which un-sticks the scheduler's `skip-low-yield` suppression
 * on cells whose last run approved < 3 drafts.
 *
 * Scope: `review_status = 'flagged'` only, within one `--type`.
 *
 * The promote policy is justified ONLY where a specific validator over-flag bug
 * was fixed, so the argument parser enforces that rather than trusting a
 * comment: `--type` is **required** (a promote pass can never sweep the pool by
 * omission), and `--grammar-point` is **required for every type except
 * `sentence_construction`** — the one type whose whole-pool sweep is the
 * historical #606 case. Widen this only alongside the same kind of evidence.
 *
 * Defaults to dry-run; pass `--apply` to write. The fallback Langfuse path
 * (LANGFUSE_PUBLIC_KEY unset) returns the in-repo prompt template byte-for-
 * byte, so dry-running locally scores exactly as Lambda would in prod.
 *
 * Usage:
 *   pnpm revalidate:promote --type sentence_construction        # dry-run, all flagged SC
 *   pnpm revalidate:promote --type sentence_construction --language TR --cefr B1
 *   pnpm revalidate:promote --type translation --grammar-point es-b1-reported-speech
 *   pnpm revalidate:promote --type cloze --grammar-point es-b1-reported-speech --limit 20
 *   pnpm revalidate:promote --type translation --grammar-point es-b1-reported-speech \
 *     --apply --max-cost-usd 10
 *
 * (A `--` separator is tolerated — the parser skips it — but not needed.)
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
import { getGrammarPoint } from '../src/curriculum';
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
  /** Required — a promote pass never sweeps more than one exercise type. */
  exerciseType: ExerciseType;
  /** Empty only for the historical pool-wide `sentence_construction` sweep. */
  grammarPoints: readonly string[];
  language: Language | null;
  cefrLevel: CefrLevel | null;
  limit: number | null;
  concurrency: number;
  maxCostUsd: number;
};

const LANGUAGE_VALUES = new Set(Object.values(Language));
const CEFR_VALUES = new Set(Object.values(CefrLevel));
const EXERCISE_TYPE_VALUES = new Set(Object.values(ExerciseType));

export function parsePromoteArgs(argv: readonly string[]): PromoteArgs {
  let apply = false;
  let exerciseType: ExerciseType | null = null;
  const grammarPoints: string[] = [];
  let language: Language | null = null;
  let cefrLevel: CefrLevel | null = null;
  let limit: number | null = null;
  let concurrency = DEFAULT_CONCURRENCY;
  let maxCostUsd = DEFAULT_MAX_COST_USD;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      continue;
    } else if (arg === '--type') {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      if (!EXERCISE_TYPE_VALUES.has(next as ExerciseType)) {
        throw new Error(
          `${arg}: expected one of ${[...EXERCISE_TYPE_VALUES].join('|')}, got '${next}'`,
        );
      }
      exerciseType = next as ExerciseType;
    } else if (arg === '--grammar-point') {
      // Validated like --language/--cefr: an unvalidated key silently selects
      // zero rows, which reads as "nothing to do" rather than "you typo'd".
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      if (!getGrammarPoint(next)) {
        throw new Error(`${arg}: unknown grammar point '${next}'`);
      }
      if (!grammarPoints.includes(next)) grammarPoints.push(next);
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

  if (exerciseType === null) {
    throw new Error(
      `--type is required (one of ${[...EXERCISE_TYPE_VALUES].join('|')}) — ` +
        'a promote pass must never sweep the pool by omission',
    );
  }
  // The promote policy is only justified where a specific validator over-flag
  // bug was fixed. `sentence_construction` is the one type whose whole-pool
  // sweep carries that evidence (PR #606); everything else must name the
  // points it has the evidence for.
  if (exerciseType !== ExerciseType.SENTENCE_CONSTRUCTION && grammarPoints.length === 0) {
    throw new Error(
      `--grammar-point is required for --type ${exerciseType}: the promote policy is ` +
        'justified only where a specific validator over-flag bug was fixed, so name the ' +
        'point(s) you have that evidence for (repeatable)',
    );
  }

  return {
    apply,
    exerciseType,
    grammarPoints,
    language,
    cefrLevel,
    limit,
    concurrency,
    maxCostUsd,
  };
}

// ---------------------------------------------------------------------------
// DB I/O
// ---------------------------------------------------------------------------

async function fetchCandidates(db: Db, args: PromoteArgs): Promise<CandidateRow[]> {
  const filters = [
    eq(exercises.type, args.exerciseType),
    // Only flagged rows are promote candidates. auto/manual-approved are
    // already served; rejected was a hard veto we do not resurrect.
    inArray(exercises.reviewStatus, ['flagged']),
  ];
  if (args.grammarPoints.length > 0) {
    filters.push(inArray(exercises.grammarPointKey, [...args.grammarPoints]));
  }
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
      // Mirror the admin approve path — a promoted row carries no flags and
      // no stale demotion reason (matters if this row was ever demoted and
      // later re-promoted; a leftover reason would silently exclude every
      // future attempt on it from scoring).
      flaggedReasons: null,
      demotionReason: null,
      qualityScore,
    })
    .where(and(eq(exercises.id, rowId), eq(exercises.reviewStatus, 'flagged')));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * `validator-error` and `cost-capped` are deliberately NOT folded into
 * `malformed-content-json`: a transport failure (bad API key, rate limit) and
 * a budget stop say nothing about the stored row, and reporting them as bad
 * content sends the reader to `content_json` for a problem that is not there.
 */
type SkipOutcomeReason =
  | SkipReason
  | 'auto-approved'
  | 'manual-approved'
  | 'rejected'
  | 'validator-error'
  | 'update-failed'
  | 'cost-capped';

type Outcome =
  | { kind: 'no-change'; row: CandidateRow; result: ValidationResult; seedWord: string | null }
  | { kind: 'promote'; row: CandidateRow; result: ValidationResult; seedWord: string | null }
  | { kind: 'skip'; row: CandidateRow; reason: SkipOutcomeReason; detail?: string };

function printSummary(
  outcomes: readonly Outcome[],
  usage: ClaudeUsageBreakdown,
  args: PromoteArgs,
): void {
  const promoted = outcomes.filter((o) => o.kind === 'promote').length;
  const noChange = outcomes.filter((o) => o.kind === 'no-change').length;
  const skipped = outcomes.filter((o) => o.kind === 'skip').length;

  process.stdout.write(`\n=== promote summary (${args.exerciseType}) ===\n`);
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

    // Promoted-vs-scanned per generation seed. On a construction-variant point
    // the seed IS the sub-construction, so this says WHICH variants a pass
    // recovered — the difference between "the validator stopped mis-vetoing a
    // variant" and "some unrelated rows happened to re-score well". Rows with
    // no seed group under `(unseeded)`, and are the natural control.
    const scannedBySeed = new Map<string, number>();
    const promotedBySeed = new Map<string, number>();
    for (const o of outcomes) {
      if (o.kind === 'skip') continue;
      const seed = o.seedWord ?? '(unseeded)';
      scannedBySeed.set(seed, (scannedBySeed.get(seed) ?? 0) + 1);
      if (o.kind === 'promote') {
        promotedBySeed.set(seed, (promotedBySeed.get(seed) ?? 0) + 1);
      }
    }
    if (scannedBySeed.size > 1) {
      process.stdout.write('\nPromoted / scanned by seed:\n');
      for (const [seed, scanned] of [...scannedBySeed.entries()].sort()) {
        process.stdout.write(
          `  ${seed.padEnd(40)}  ${promotedBySeed.get(seed) ?? 0}/${scanned}\n`,
        );
      }
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
    // One worked example per reason: the count alone cannot tell a bad API key
    // from bad stored content, and both arrive as a wall of identical skips.
    const shown = new Set<string>();
    for (const o of outcomes) {
      if (o.kind !== 'skip' || !o.detail || shown.has(o.reason)) continue;
      shown.add(o.reason);
      process.stdout.write(`    e.g. ${o.reason}: ${o.detail}\n`);
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
    `Filters: type=${args.exerciseType} review_status=flagged` +
      `${args.grammarPoints.length > 0 ? ` grammar-point=${args.grammarPoints.join(',')}` : ''}` +
      `${args.language ? ` language=${args.language}` : ''}` +
      `${args.cefrLevel ? ` cefr=${args.cefrLevel}` : ''}` +
      `${args.limit !== null ? ` limit=${args.limit}` : ''}\n`,
  );

  const candidates = await fetchCandidates(db, args);
  if (candidates.length === 0) {
    process.stdout.write('No matching rows.\n');
    return;
  }
  process.stdout.write(`Found ${candidates.length} flagged ${args.exerciseType} candidate rows.\n`);

  const limit = pLimit(args.concurrency);
  let usage: ClaudeUsageBreakdown = ZERO_USAGE;
  const outcomes: Outcome[] = [];
  let costStopped = false;

  await Promise.all(
    candidates.map((row, idx) =>
      limit(async () => {
        if (costStopped) {
          outcomes[idx] = { kind: 'skip', row, reason: 'cost-capped', detail: 'cost-cap reached' };
          return;
        }

        const recon = reconstructDraftAndSpec(row, args.exerciseType);
        if (!recon.ok) {
          outcomes[idx] = { kind: 'skip', row, reason: recon.reason, detail: recon.detail };
          return;
        }

        let result: ValidationResult;
        let callUsage: ClaudeUsageBreakdown;
        try {
          // Pass the row's stored generation seed so a construction-variant
          // row is re-judged against the sub-construction it was generated
          // for, exactly as the live generation path now does. Without it
          // this pass would re-inflict the 2026-08-18 asymmetry on the
          // stored pool. `null` for every unseeded row — no change there.
          const r = await validateDraft(client, recon.draft, recon.spec, undefined, {
            seedWord: recon.seedWord,
          });
          result = r.result;
          callUsage = r.tokenUsage;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          outcomes[idx] = {
            kind: 'skip',
            row,
            reason: 'validator-error',
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
          outcomes[idx] = { kind: 'no-change', row, result, seedWord: recon.seedWord };
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
              reason: 'update-failed',
              detail: `update failed: ${message}`,
            };
            return;
          }
        }
        outcomes[idx] = { kind: 'promote', row, result, seedWord: recon.seedWord };
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
