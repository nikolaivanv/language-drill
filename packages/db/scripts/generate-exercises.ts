/**
 * `pnpm generate:exercises` — Phase 2 CLI driver for the Claude-backed
 * exercise generator. Resolves cells, runs `generateBatch` per cell, inserts
 * drafts into `exercises` + `exercise_tags`, opens/closes a `generation_jobs`
 * audit row, and prints a summary.
 *
 * Skeleton (Task 16) wired up `parseGenerateArgs`, `resolveCells`, env checks,
 * the production guard, the dry-run printout, and the `isDirectRun` entry.
 * Task 17 fills in the real `runOneCell` writer (cell-isolated try/catch
 * around `generateBatch` + bulk INSERTs + audit-row open/close). Concurrency,
 * cost-cap, summary printer, and SIGINT handling land in Tasks 18–19.
 *
 * Usage:
 *   pnpm generate:exercises --lang es --level B1 --type cloze \
 *     --grammar-point es-b1-present-subjunctive --count 50
 *
 * Required env: ANTHROPIC_API_KEY, DATABASE_URL.
 *               MOCK_CLAUDE=1 substitutes a fixture-driven mock client.
 */

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type Anthropic from '@anthropic-ai/sdk';
import {
  GENERATION_MODEL,
  ZERO_USAGE,
  addUsage,
  canonicalSurface,
  createClaudeClient,
  estimateCostUsd,
  generateBatch,
  validateDraft,
  type ClaudeUsageBreakdown,
  type ExerciseDraft,
  type GenerationSpec,
} from '@language-drill/ai';
import { eq } from 'drizzle-orm';

import { createDb, type Db } from '../src/client';
import { ALL_CURRICULA } from '../src/curriculum';
import { assertValidCellKey } from '../src/lib/cell-key';
import { deterministicUuid } from '../src/lib/deterministic-uuid';
import {
  exerciseTags,
  exercises,
  generationJobs,
  skillTopics,
} from '../src/schema/index';

import {
  parseGenerateArgs,
  type ParsedArgs,
} from './generate-exercises-parse-args';
import {
  resolveCells,
  type Cell,
} from './generate-exercises-resolve-cells';
import { createMockAnthropicClient } from './generate-exercises-mock-client';
import { routeValidationResult } from './generate-exercises-validate';
import { requireEnv } from './env-helpers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Empirical per-draft token usage used by the dry-run cost estimate. */
const DRY_RUN_INPUT_TOKENS_PER_DRAFT = 1500;
const DRY_RUN_OUTPUT_TOKENS_PER_DRAFT = 400;

/** generation_jobs.error_message column truncates at 1000 chars (Requirement 5.3). */
const ERROR_MESSAGE_MAX_LENGTH = 1000;

/** Per-cell summary line: head of the error message kept short for readability. */
const ERROR_MESSAGE_HEAD_LENGTH = 80;

// ---------------------------------------------------------------------------
// SIGINT handling
// ---------------------------------------------------------------------------
//
// Module-level abort flag toggled by the SIGINT handler installed at the top
// of `main`. SIGINT semantics: cell-level isolation guarantees no partial
// drafts ever land — drafts are committed only after `generateBatch` resolves
// AND `aborted` is still false at that moment. Three SIGINT timing cases all
// resolve cleanly:
//
//   1. SIGINT during a Claude call: the SDK resolves (after retries); the
//      post-`generateBatch` `aborted` check throws, so the cell-level catch
//      updates the audit row to 'failed' and the bulk INSERTs are skipped.
//   2. SIGINT between drafts inside `generateBatch`: out of scope for Phase 2
//      (the loop runs to completion before the abort check fires).
//   3. SIGINT between cells: `runWithCostCap` short-circuits each remaining
//      cell to a `skipped-cost-cap` row carrying `errorMessage: 'Aborted...'`.
let aborted = false;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CellResult = {
  cell: Cell;
  jobId: string;
  status: 'succeeded' | 'failed' | 'skipped-cost-cap';
  /** Rows that survived dedup AND validation (was: every successful generateBatch result in Phase 2). */
  insertedCount: number;
  /** Drafts whose first INSERT collided with the dedup index (per-ordinal granularity). */
  skippedCount: number;
  /** Generator + validator + retries combined. */
  tokenUsage: ClaudeUsageBreakdown;
  costUsd: number;
  errorMessage?: string;
  durationMs: number;
  inBatchDuplicateCount: number;
  // Phase 3:
  /** Every draft that hit the validator (incl. retries). */
  validatedCount: number;
  /** 'flagged' rows inserted. */
  flaggedCount: number;
  /** Routed-rejected + retry-given-up. */
  rejectedCount: number;
  /** Ordinals where all 3 retries collided or all rejected. */
  dedupGivenUpCount: number;
};

// ---------------------------------------------------------------------------
// Dry-run summary
// ---------------------------------------------------------------------------

export function printDryRunSummary(cells: readonly Cell[], args: ParsedArgs): void {
  const perCellInputTokens = DRY_RUN_INPUT_TOKENS_PER_DRAFT * args.count;
  const perCellOutputTokens = DRY_RUN_OUTPUT_TOKENS_PER_DRAFT * args.count;
  const perCellUsage: ClaudeUsageBreakdown = {
    inputTokens: perCellInputTokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: perCellOutputTokens,
  };
  const perCellCost = estimateCostUsd(perCellUsage);

  process.stdout.write(`Dry run — ${cells.length} cell(s), ${args.count} drafts each:\n`);
  for (const cell of cells) {
    process.stdout.write(
      `  [${cell.language} ${cell.cefrLevel} ${cell.exerciseType} ${cell.grammarPoint.key}]` +
        ` ~${perCellInputTokens.toLocaleString()} input / ${perCellOutputTokens.toLocaleString()} output tokens` +
        ` — ~$${perCellCost.toFixed(4)}\n`,
    );
  }

  const totalCost = perCellCost * cells.length;
  process.stdout.write(
    `Total estimated cost: ~$${totalCost.toFixed(4)} (cap: $${args.maxCostUsd.toFixed(2)})\n`,
  );
}

// ---------------------------------------------------------------------------
// validateAndInsertWithRetry — Phase 3 per-draft pipeline.
//
// For each draft produced by `generateBatch`, runs the validator → routes
// the verdict → on auto-approved/flagged inserts the row, on rejected drops
// it, on dedup-collision regenerates a fresh draft with a bumped batchSeed
// and retries (up to 3× per ordinal). Returns one of five terminal statuses
// the caller (Task 16's runOneCell) folds into the cell-level counters.
// ---------------------------------------------------------------------------

const MAX_DEDUP_RETRIES = 3;

export type DraftOutcome = {
  terminalStatus:
    | 'inserted-approved'
    | 'inserted-flagged'
    | 'rejected'
    | 'first-attempt-dedup-then-success'
    | 'dedup-given-up';
  /** Set when terminalStatus is one of the inserted-* / dedup-then-success cases. */
  terminalReviewStatus?: 'auto-approved' | 'flagged';
  /** Generator + validator usage from retries (the original generator call's
   *  usage is folded by the caller; the original validator call's usage IS
   *  included here — see validate.test.ts:295 regression note in design). */
  extraUsage: ClaudeUsageBreakdown;
  /** Additional drafts Claude produced via retries (0..MAX_DEDUP_RETRIES). */
  extraProduced: number;
  /** 1 (original validator call) + N retry validator calls. */
  validatedCount: number;
};

export type RunOneCellOpts = {
  db: Db;
  client: Anthropic;
  spec: GenerationSpec;
  draft: ExerciseDraft;
  ordinal: number;
  cell: Cell;
  args: ParsedArgs;
  generatedAt: Date;
};

/**
 * Issue a single-draft regeneration with a bumped batchSeed so the
 * deterministic UUID derivation produces a fresh id distinct from the
 * original/prior retry attempts.
 */
async function runRetryGeneration(
  client: Anthropic,
  spec: GenerationSpec,
  retryN: number,
): Promise<{ draft: ExerciseDraft; usage: ClaudeUsageBreakdown }> {
  const retrySpec: GenerationSpec = {
    ...spec,
    count: 1,
    batchSeed: `${spec.batchSeed}::retry-${retryN}`,
  };
  const result = await generateBatch(client, retrySpec);
  return { draft: result.drafts[0], usage: result.tokenUsage };
}

export async function validateAndInsertWithRetry(
  opts: RunOneCellOpts,
): Promise<DraftOutcome> {
  let extraUsage: ClaudeUsageBreakdown = ZERO_USAGE;
  let extraProduced = 0;
  let validatedCount = 0;

  // Attempt 0 = the original draft from the cell's batch. Subsequent attempts
  // are dedup retries.
  let currentDraft: ExerciseDraft = opts.draft;
  let firstAttemptDeduped = false;

  for (let attempt = 0; attempt <= MAX_DEDUP_RETRIES; attempt++) {
    if (aborted) throw new Error('Aborted by user (SIGINT)');

    // Validate. Every validator call's usage folds into extraUsage — there
    // is NO conditional guard on attempt index (the bug the design validator
    // caught). Token-totals regression test in Task 25 enforces this.
    const { result, tokenUsage: valUsage } = await validateDraft(
      opts.client,
      currentDraft,
      opts.spec,
    );
    extraUsage = addUsage(extraUsage, valUsage);
    validatedCount++;

    const decision = routeValidationResult(result);

    // ---- Rejected branch ------------------------------------------------
    if (decision.reviewStatus === 'rejected') {
      // If we're already retrying a dedup-collided slot, dispatch another
      // retry; if we've exhausted retries, give up on this slot.
      if (firstAttemptDeduped && attempt < MAX_DEDUP_RETRIES) {
        const retry = await runRetryGeneration(
          opts.client,
          opts.spec,
          attempt + 1,
        );
        currentDraft = retry.draft;
        extraUsage = addUsage(extraUsage, retry.usage);
        extraProduced += 1;
        continue;
      }
      return firstAttemptDeduped
        ? {
            terminalStatus: 'dedup-given-up',
            extraUsage,
            extraProduced,
            validatedCount,
          }
        : {
            terminalStatus: 'rejected',
            extraUsage,
            extraProduced,
            validatedCount,
          };
    }

    // ---- Auto-approved or flagged branch — attempt INSERT ---------------
    const dedupKey = canonicalSurface(currentDraft.contentJson);
    const contentWithKey = { ...currentDraft.contentJson, _dedupKey: dedupKey };
    const inserted = await opts.db
      .insert(exercises)
      .values({
        id: currentDraft.id,
        type: opts.cell.exerciseType,
        language: opts.cell.language,
        difficulty: opts.cell.cefrLevel,
        contentJson: contentWithKey,
        grammarPointKey: opts.cell.grammarPoint.key,
        topicDomain: opts.args.topicDomain,
        generationSource: 'claude-realtime' as const,
        modelId: GENERATION_MODEL,
        reviewStatus: decision.reviewStatus,
        qualityScore: result.qualityScore,
        flaggedReasons:
          decision.flaggedReasons.length > 0 ? decision.flaggedReasons : null,
        generatedAt: opts.generatedAt,
      })
      .onConflictDoNothing()
      .returning({ id: exercises.id });

    if (inserted.length > 0) {
      // Tag insert. PK (exerciseId, skillTopicId) covers re-runs.
      const skillTopicId = deterministicUuid(
        `skill-topic:${opts.cell.grammarPoint.key}`,
      );
      await opts.db
        .insert(exerciseTags)
        .values({ exerciseId: currentDraft.id, skillTopicId })
        .onConflictDoNothing();

      const terminalStatus = firstAttemptDeduped
        ? ('first-attempt-dedup-then-success' as const)
        : decision.reviewStatus === 'auto-approved'
          ? ('inserted-approved' as const)
          : ('inserted-flagged' as const);

      return {
        terminalStatus,
        terminalReviewStatus: decision.reviewStatus,
        extraUsage,
        extraProduced,
        validatedCount,
      };
    }

    // INSERT was a no-op: dedup-index conflict on _dedupKey within the cell.
    firstAttemptDeduped = true;
    if (attempt < MAX_DEDUP_RETRIES) {
      const retry = await runRetryGeneration(
        opts.client,
        opts.spec,
        attempt + 1,
      );
      currentDraft = retry.draft;
      extraUsage = addUsage(extraUsage, retry.usage);
      extraProduced += 1;
    }
  }

  // All attempts collided with the dedup index without a successful INSERT.
  return {
    terminalStatus: 'dedup-given-up',
    extraUsage,
    extraProduced,
    validatedCount,
  };
}

// ---------------------------------------------------------------------------
// runOneCell — opens an audit row, runs generateBatch, bulk-inserts drafts,
// closes the audit row. Cell-isolated try/catch: a single bad cell does not
// halt the run (Requirement 4.6); the failed audit row is the operator's
// signal to investigate.
// ---------------------------------------------------------------------------

export async function runOneCell(
  db: Db,
  client: Anthropic,
  cell: Cell,
  args: ParsedArgs,
): Promise<CellResult> {
  const startedAt = Date.now();
  const jobId = randomUUID();

  // Defense-in-depth — `resolveCells` constructs the key from typed inputs and
  // already calls this; an exception here means resolveCells drifted from the
  // regex.
  assertValidCellKey(cell.cellKey);

  // Skill-topic precheck (Requirement 8.4 / design Error scenario 6).
  const skillTopicId = deterministicUuid(`skill-topic:${cell.grammarPoint.key}`);
  const skillTopicRows = await db
    .select({ id: skillTopics.id })
    .from(skillTopics)
    .where(eq(skillTopics.id, skillTopicId))
    .limit(1);
  if (skillTopicRows.length === 0) {
    const message = `Skill-topic row missing for ${cell.grammarPoint.key}. Run pnpm db:seed:exercises before generating.`;
    return failClosed({
      cell,
      jobId,
      tokenUsage: ZERO_USAGE,
      durationMs: Date.now() - startedAt,
      errorMessage: message,
      // No audit row exists yet — the precheck happened before the INSERT.
      auditRowExists: false,
      db,
    });
  }

  // Open the audit row in 'running' state.
  await db.insert(generationJobs).values({
    id: jobId,
    cellKey: cell.cellKey,
    requestedCount: args.count,
    status: 'running',
    trigger: 'cli',
  });

  const spec: GenerationSpec = {
    language: cell.language,
    cefrLevel: cell.cefrLevel,
    exerciseType: cell.exerciseType,
    grammarPoint: cell.grammarPoint,
    topicDomain: args.topicDomain,
    count: args.count,
    batchSeed: args.batchSeed,
  };

  // Phase 3 accumulators. `combinedUsage` starts at the generator batch's
  // usage so the original generator call is counted exactly once; per-draft
  // `outcome.extraUsage` covers every validator call + every retry's
  // generator+validator. Counts grow during the per-ordinal loop below.
  let combinedUsage: ClaudeUsageBreakdown = ZERO_USAGE;
  let producedCount = 0;
  let approvedCount = 0;
  let flaggedCount = 0;
  let rejectedCount = 0;
  let validatedCount = 0;
  let dedupGivenUpCount = 0;
  let insertedCount = 0;
  let firstAttemptSkippedCount = 0;
  let inBatchDuplicateCount = 0;
  const generatedAt = new Date();

  try {
    const batch = await generateBatch(client, spec);
    // Window between Claude resolving and the per-draft loop — if SIGINT
    // arrived during the Claude call, abort here so partial drafts never land.
    if (aborted) {
      throw new Error('Aborted by user (SIGINT)');
    }
    combinedUsage = addUsage(combinedUsage, batch.tokenUsage);
    producedCount += batch.drafts.length;
    inBatchDuplicateCount = batch.drafts.filter(
      (d) => d.metadata.inBatchDuplicate,
    ).length;

    for (let ordinal = 0; ordinal < batch.drafts.length; ordinal++) {
      const draft = batch.drafts[ordinal];
      if (aborted) throw new Error('Aborted by user (SIGINT)');

      const outcome = await validateAndInsertWithRetry({
        db,
        client,
        spec,
        draft,
        ordinal,
        cell,
        args,
        generatedAt,
      });

      combinedUsage = addUsage(combinedUsage, outcome.extraUsage);
      producedCount += outcome.extraProduced;
      validatedCount += outcome.validatedCount;

      switch (outcome.terminalStatus) {
        case 'inserted-approved':
          approvedCount += 1;
          insertedCount += 1;
          break;
        case 'inserted-flagged':
          flaggedCount += 1;
          insertedCount += 1;
          break;
        case 'rejected':
          rejectedCount += 1;
          break;
        case 'first-attempt-dedup-then-success':
          firstAttemptSkippedCount += 1;
          insertedCount += 1;
          if (outcome.terminalReviewStatus === 'auto-approved') {
            approvedCount += 1;
          } else {
            flaggedCount += 1;
          }
          break;
        case 'dedup-given-up':
          firstAttemptSkippedCount += 1;
          rejectedCount += 1;
          dedupGivenUpCount += 1;
          break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failClosed({
      cell,
      jobId,
      tokenUsage: combinedUsage,
      durationMs: Date.now() - startedAt,
      errorMessage: message,
      auditRowExists: true,
      db,
    });
  }

  const costUsd = estimateCostUsd(combinedUsage);
  const totalInputTokens =
    combinedUsage.inputTokens +
    combinedUsage.cacheCreationInputTokens +
    combinedUsage.cacheReadInputTokens;

  // Close the audit row as 'succeeded'. Counts reflect Phase 3 outcomes.
  await db
    .update(generationJobs)
    .set({
      status: 'succeeded',
      finishedAt: new Date(),
      producedCount,
      approvedCount,
      flaggedCount,
      rejectedCount,
      inputTokensUsed: totalInputTokens,
      outputTokensUsed: combinedUsage.outputTokens,
      costUsdEstimate: costUsd.toFixed(4),
    })
    .where(eq(generationJobs.id, jobId));

  return {
    cell,
    jobId,
    status: 'succeeded',
    insertedCount,
    skippedCount: firstAttemptSkippedCount,
    tokenUsage: combinedUsage,
    costUsd,
    durationMs: Date.now() - startedAt,
    inBatchDuplicateCount,
    validatedCount,
    flaggedCount,
    rejectedCount,
    dedupGivenUpCount,
  };
}

// Failure path shared by precheck + generateBatch failures. When auditRowExists
// is true, updates the running row to 'failed'; otherwise the row was never
// opened (precheck happened first), so there's nothing to update.
async function failClosed(opts: {
  cell: Cell;
  jobId: string;
  tokenUsage: ClaudeUsageBreakdown;
  durationMs: number;
  errorMessage: string;
  auditRowExists: boolean;
  db: Db;
}): Promise<CellResult> {
  const truncatedMessage = opts.errorMessage.slice(0, ERROR_MESSAGE_MAX_LENGTH);
  if (opts.auditRowExists) {
    await opts.db
      .update(generationJobs)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: truncatedMessage,
      })
      .where(eq(generationJobs.id, opts.jobId));
  }
  return {
    cell: opts.cell,
    jobId: opts.jobId,
    status: 'failed',
    insertedCount: 0,
    skippedCount: 0,
    tokenUsage: opts.tokenUsage,
    costUsd: 0,
    errorMessage: truncatedMessage,
    durationMs: opts.durationMs,
    inBatchDuplicateCount: 0,
    validatedCount: 0,
    flaggedCount: 0,
    rejectedCount: 0,
    dedupGivenUpCount: 0,
  };
}

// ---------------------------------------------------------------------------
// pLimit — tiny inline concurrency limiter (avoids a third-party dep).
// ---------------------------------------------------------------------------

type LimitFn = <T>(fn: () => Promise<T>) => Promise<T>;

export function pLimit(concurrency: number): LimitFn {
  if (concurrency < 1) throw new Error('pLimit: concurrency must be >= 1');
  let active = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (job) job();
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      };
      queue.push(run);
      next();
    });
}

// ---------------------------------------------------------------------------
// Summary printer
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${minutes}m${seconds}s`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

function formatCellLine(result: CellResult): string {
  const { cell } = result;
  const inputTotal =
    result.tokenUsage.inputTokens +
    result.tokenUsage.cacheCreationInputTokens +
    result.tokenUsage.cacheReadInputTokens;
  const cached = result.tokenUsage.cacheReadInputTokens;
  const output = result.tokenUsage.outputTokens;

  // For succeeded rows show the Phase 3 validation breakdown. For failed /
  // skipped-cost-cap rows the validator never ran for most/all drafts; fall
  // back to Phase 2's "<inserted>, <skipped>" format since the breakdown
  // would be misleading.
  let totalDrafts: number;
  let breakdown: string;
  if (result.status === 'succeeded') {
    totalDrafts = result.insertedCount + result.rejectedCount;
    const approvedCount = result.insertedCount - result.flaggedCount;
    const plainRejectedCount = result.rejectedCount - result.dedupGivenUpCount;
    breakdown =
      `${result.insertedCount} inserted ` +
      `(${approvedCount} approved, ${result.flaggedCount} flagged, ` +
      `${plainRejectedCount} rejected, ${result.dedupGivenUpCount} dedup-given-up)`;
  } else {
    totalDrafts = result.insertedCount + result.skippedCount;
    breakdown = `${result.insertedCount} inserted, ${result.skippedCount} skipped`;
  }

  let line =
    `[${cell.language} ${cell.cefrLevel} ${cell.exerciseType} ${cell.grammarPoint.key}]` +
    ` ${totalDrafts} drafts → ${breakdown}` +
    ` — ${inputTotal.toLocaleString('en-US')} input (${cached.toLocaleString('en-US')} cached)` +
    ` / ${output.toLocaleString('en-US')} output tokens` +
    ` — $${result.costUsd.toFixed(4)}` +
    ` — ${formatDuration(result.durationMs)}` +
    ` — ${result.status}`;

  if (result.status === 'failed' && result.errorMessage) {
    line += ` (${result.errorMessage.slice(0, ERROR_MESSAGE_HEAD_LENGTH)})`;
  } else if (result.status === 'skipped-cost-cap') {
    line += result.errorMessage
      ? ` (${result.errorMessage.slice(0, ERROR_MESSAGE_HEAD_LENGTH)})`
      : ' (cost cap reached)';
  }

  if (result.inBatchDuplicateCount > 0) {
    line += ` [${result.inBatchDuplicateCount} in-batch duplicates]`;
  }

  return line;
}

export function printSummary(
  results: readonly CellResult[],
  totalCostUsd: number,
  totalDurationMs: number,
): void {
  for (const result of results) {
    process.stdout.write(`${formatCellLine(result)}\n`);
    if (result.inBatchDuplicateCount > 0) {
      process.stderr.write(
        `Warning: cell ${result.cell.cellKey} produced ${result.inBatchDuplicateCount} in-batch duplicate(s) — Claude reused stems despite the recentStems constraint.\n`,
      );
    }
  }

  const succeeded = results.filter((r) => r.status === 'succeeded').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped-cost-cap').length;
  const draftsInserted = results.reduce((sum, r) => sum + r.insertedCount, 0);
  const totalFlagged = results.reduce((sum, r) => sum + r.flaggedCount, 0);
  const totalApproved = draftsInserted - totalFlagged;
  const totalRejected = results.reduce((sum, r) => sum + r.rejectedCount, 0);
  const totalDedupGivenUp = results.reduce(
    (sum, r) => sum + r.dedupGivenUpCount,
    0,
  );
  const plainRejected = totalRejected - totalDedupGivenUp;
  const totalUsage = results.reduce<ClaudeUsageBreakdown>(
    (acc, r) => addUsage(acc, r.tokenUsage),
    ZERO_USAGE,
  );
  const totalInput =
    totalUsage.inputTokens + totalUsage.cacheCreationInputTokens + totalUsage.cacheReadInputTokens;
  const totalCached = totalUsage.cacheReadInputTokens;

  process.stdout.write('\n═══ Total ═══\n');
  process.stdout.write(
    `Cells: ${results.length} (${succeeded} succeeded, ${failed} failed, ${skipped} skipped)\n`,
  );
  process.stdout.write(
    `Drafts inserted: ${draftsInserted.toLocaleString('en-US')}` +
      ` (${totalApproved.toLocaleString('en-US')} approved,` +
      ` ${totalFlagged.toLocaleString('en-US')} flagged)\n`,
  );
  process.stdout.write(
    `Validation outcomes: ${plainRejected.toLocaleString('en-US')} rejected,` +
      ` ${totalDedupGivenUp.toLocaleString('en-US')} dedup-given-up\n`,
  );
  process.stdout.write(
    `Total input tokens: ${totalInput.toLocaleString('en-US')} (cached: ${totalCached.toLocaleString('en-US')})\n`,
  );
  process.stdout.write(`Total output tokens: ${totalUsage.outputTokens.toLocaleString('en-US')}\n`);
  process.stdout.write(`Estimated cost: $${totalCostUsd.toFixed(4)}\n`);
  process.stdout.write(`Total runtime: ${formatDuration(totalDurationMs)}\n`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  // Reset for every invocation so tests calling main() multiple times don't
  // inherit the abort flag from a prior run.
  aborted = false;
  process.on('SIGINT', () => {
    aborted = true;
  });

  const args = parseGenerateArgs(argv);

  if (process.env['NODE_ENV'] === 'production' && !args.allowProd) {
    console.error(
      'Refusing to run in production. Pass --allow-prod or use the Phase 4 Lambda path.',
    );
    process.exit(1);
  }

  const cells = resolveCells(args, ALL_CURRICULA);

  if (args.dryRun) {
    printDryRunSummary(cells, args);
    return;
  }

  const client: Anthropic =
    process.env['MOCK_CLAUDE'] === '1'
      ? createMockAnthropicClient()
      : createClaudeClient(requireEnv('ANTHROPIC_API_KEY'));
  const db = createDb(requireEnv('DATABASE_URL'));

  const limit = pLimit(args.concurrency);
  let totalCostUsd = 0;
  const startedAt = Date.now();

  // Cell-level cost cap: cells dispatched after the cap is hit are short-
  // circuited without making any DB or Claude call. Cells already in flight
  // run to completion — drafts are committed only after generateBatch resolves.
  const runWithCostCap = async (cell: Cell): Promise<CellResult> => {
    if (aborted) {
      return {
        cell,
        jobId: '',
        status: 'skipped-cost-cap',
        insertedCount: 0,
        skippedCount: 0,
        tokenUsage: ZERO_USAGE,
        costUsd: 0,
        errorMessage: 'Aborted by user (SIGINT)',
        durationMs: 0,
        inBatchDuplicateCount: 0,
        validatedCount: 0,
        flaggedCount: 0,
        rejectedCount: 0,
        dedupGivenUpCount: 0,
      };
    }
    if (totalCostUsd >= args.maxCostUsd) {
      return {
        cell,
        jobId: '',
        status: 'skipped-cost-cap',
        insertedCount: 0,
        skippedCount: 0,
        tokenUsage: ZERO_USAGE,
        costUsd: 0,
        durationMs: 0,
        inBatchDuplicateCount: 0,
        validatedCount: 0,
        flaggedCount: 0,
        rejectedCount: 0,
        dedupGivenUpCount: 0,
      };
    }
    const result = await runOneCell(db, client, cell, args);
    totalCostUsd += result.costUsd;
    return result;
  };

  const results = await Promise.all(
    cells.map((cell) => limit(() => runWithCostCap(cell))),
  );

  printSummary(results, totalCostUsd, Date.now() - startedAt);

  if (aborted) {
    console.error('Aborted');
    process.exit(1);
  }

  if (
    results.some((r) => r.status === 'failed') ||
    totalCostUsd > args.maxCostUsd
  ) {
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Direct-run guard (so tests can `import { main }` without re-execing)
// ---------------------------------------------------------------------------

const isDirectRun = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('generate-exercises failed:', err);
    process.exit(1);
  });
}
