/**
 * `pnpm generate:exercises` — CLI driver for the Claude-backed exercise
 * generator. Resolves cells, dispatches each cell to the shared `runOneCell`
 * orchestration core (`@language-drill/db` → `packages/db/src/generation/`),
 * applies the cell-level cost cap, and prints a summary.
 *
 * Phase 4 extracted the per-cell pipeline (audit row + generator + validator +
 * dedup retry + per-draft INSERT) to `packages/db/src/generation/run-one-cell.ts`
 * so the same code drives both this CLI and the new generation Lambda. The CLI
 * keeps argument parsing, cell-list resolution, the concurrency limiter,
 * SIGINT bridging, the summary printer, and the direct-run guard.
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

import { SQSClient } from '@aws-sdk/client-sqs';
import type Anthropic from '@anthropic-ai/sdk';
import {
  ZERO_USAGE,
  addUsage,
  createClaudeClient,
  estimateCostUsd,
  type ClaudeUsageBreakdown,
} from '@language-drill/ai';

import { createDb } from '../src/client';
import { ALL_CURRICULA } from '../src/curriculum';
import {
  runOneCell,
  type CellResult,
} from '../src/generation/run-one-cell';

import { requireEnv } from './env-helpers';
import {
  parseGenerateArgs,
  type ParsedArgs,
} from './generate-exercises-parse-args';
import { postCellsToQueue } from './generate-exercises-queue';
import {
  resolveCells,
  type Cell,
} from './generate-exercises-resolve-cells';
import { createMockAnthropicClient } from './generate-exercises-mock-client';
import { pLimit } from './p-limit';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Empirical per-draft token usage used by the dry-run cost estimate. */
const DRY_RUN_INPUT_TOKENS_PER_DRAFT = 1500;
const DRY_RUN_OUTPUT_TOKENS_PER_DRAFT = 400;

/** Per-cell summary line: head of the error message kept short for readability. */
const ERROR_MESSAGE_HEAD_LENGTH = 80;

// ---------------------------------------------------------------------------
// Re-exports for back-compat with Phase 3 test imports
// ---------------------------------------------------------------------------
//
// The existing `packages/db/scripts/generate-exercises.test.ts` imports
// `CellResult` from this file. Phase 4's extraction moves the type's home to
// `packages/db/src/generation/run-one-cell.ts`; re-export here so tests don't
// need source changes.
export type { CellResult };

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
  if (result.malformedDraftCount > 0) {
    line += ` [${result.malformedDraftCount} malformed drafts]`;
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
  const args = parseGenerateArgs(argv);

  if (process.env['NODE_ENV'] === 'production' && !args.allowProd) {
    console.error(
      'Refusing to run in production. Pass --allow-prod or use the Phase 4 Lambda path.',
    );
    process.exit(1);
  }

  if (args.queue) {
    return await mainQueue(args);
  }
  return await mainLocal(args);
}

/**
 * Phase 4 — `--queue` dispatch. Posts one `GenerationJobMessage` per resolved
 * cell to SQS instead of running the pipeline locally. Inherits the prod guard
 * from `main`'s top-level check; the substring guard inside `postCellsToQueue`
 * is defense-in-depth on top of the Lambda's `ENV_NAME=production && trigger='cli'`
 * reject (Req 2.6).
 */
async function mainQueue(args: ParsedArgs): Promise<void> {
  const queueUrl = requireEnv('GENERATION_QUEUE_URL');
  const region = requireEnv('AWS_REGION');
  const sqs = new SQSClient({ region });

  const cells = resolveCells(args, ALL_CURRICULA);

  await postCellsToQueue(sqs, queueUrl, {
    cells,
    batchSeed: args.batchSeed,
    topicDomain: args.topicDomain,
    count: args.count,
    maxCostUsd: args.maxCostUsd,
    allowProd: args.allowProd,
    dryRun: args.dryRun,
  });
}

/**
 * Phase 3 local-run path. Connects to Neon directly, calls Claude, runs the
 * full `runOneCell` pipeline per cell, prints the multi-cell summary. The
 * SIGINT handler lives here because only this path needs a signal — the queue
 * path is a one-shot post.
 */
async function mainLocal(args: ParsedArgs): Promise<void> {
  // Bridge SIGINT to an AbortController. Each invocation of `mainLocal` gets
  // its own controller so tests calling `main()` multiple times don't inherit
  // an aborted signal from a prior run.
  const abortController = new AbortController();
  process.on('SIGINT', () => abortController.abort());
  const signal = abortController.signal;

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
    if (signal.aborted) {
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
    const result = await runOneCell({
      db,
      client,
      cell,
      args: {
        count: args.count,
        batchSeed: args.batchSeed,
        topicDomain: args.topicDomain,
        maxCostUsd: args.maxCostUsd,
      },
      jobId: randomUUID(),
      trigger: 'cli',
      signal,
    });
    totalCostUsd += result.costUsd;
    return result;
  };

  const results = await Promise.all(
    cells.map((cell) => limit(() => runWithCostCap(cell))),
  );

  printSummary(results, totalCostUsd, Date.now() - startedAt);

  if (signal.aborted) {
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
