/**
 * `pnpm generate:theory` — CLI driver for the Claude-backed theory pool
 * generator. Resolves grammar-point cells, dispatches each cell to
 * `runOneTheoryCell` (`@language-drill/db` → `packages/db/src/theory-
 * generation/`), applies the cell-level cost cap, and prints a summary.
 *
 * Phase 2's scope mirrors `generate-exercises.ts` minus two axes:
 *   - No `--queue` branch — Phase 4's Lambda replaces the CLI for prod.
 *   - No validation-breakdown columns — theory has no validator pass
 *     (Req 7.4); the per-cell summary is `<inserted>/<total>` only.
 *
 * Usage:
 *   pnpm generate:theory --lang es --level B1 \
 *     --grammar-point es-b1-present-subjunctive
 *
 * Required env: ANTHROPIC_API_KEY, DATABASE_URL.
 *               MOCK_CLAUDE=1 substitutes a fixture-driven mock client.
 *
 * Task 20a ships the pure summary helpers + constants below; Task 20b adds
 * the `main` / `runWithCostCap` / direct-run wiring on top.
 */

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
import { requireEnv } from '../src/lib/env';
import {
  runOneTheoryCell,
  type TheoryCell,
  type TheoryCellResult,
} from '../src/theory-generation';

import { createTheoryMockClient } from './generate-theory-mock-client';
import {
  parseTheoryGenerateArgs,
  type ParsedTheoryArgs,
} from './generate-theory-parse-args';
import { resolveTheoryCells } from './generate-theory-resolve-cells';
import { pLimit } from './p-limit';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Empirical per-cell token usage used by the dry-run cost estimate. */
const DRY_RUN_INPUT_TOKENS_PER_CELL = 5000;
const DRY_RUN_OUTPUT_TOKENS_PER_CELL = 3000;

/** Per-cell summary line: head of the error message kept short for readability. */
const ERROR_MESSAGE_HEAD_LENGTH = 80;

// ---------------------------------------------------------------------------
// Dry-run summary
// ---------------------------------------------------------------------------

export function printDryRunSummary(
  cells: readonly TheoryCell[],
  args: ParsedTheoryArgs,
): void {
  const perCellUsage: ClaudeUsageBreakdown = {
    inputTokens: DRY_RUN_INPUT_TOKENS_PER_CELL,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: DRY_RUN_OUTPUT_TOKENS_PER_CELL,
  };
  const perCellCost = estimateCostUsd(perCellUsage);

  for (const cell of cells) {
    process.stdout.write(
      `[${cell.language} ${cell.cefrLevel} ${cell.grammarPoint.key}]` +
        ` ~${DRY_RUN_INPUT_TOKENS_PER_CELL.toLocaleString('en-US')} input` +
        ` / ${DRY_RUN_OUTPUT_TOKENS_PER_CELL.toLocaleString('en-US')} output tokens` +
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

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${minutes}m${seconds}s`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

export function formatTheoryCellLine(result: TheoryCellResult): string {
  const inputTotal =
    result.tokenUsage.inputTokens +
    result.tokenUsage.cacheCreationInputTokens +
    result.tokenUsage.cacheReadInputTokens;
  const cached = result.tokenUsage.cacheReadInputTokens;
  const output = result.tokenUsage.outputTokens;
  const total = result.insertedCount + result.skippedCount;

  let line =
    `[${result.cell.language} ${result.cell.cefrLevel} ${result.cell.grammarPoint.key}]` +
    ` ${result.insertedCount}/${total} inserted (${result.skippedCount} skipped)` +
    ` — ${inputTotal.toLocaleString('en-US')} input (${cached.toLocaleString('en-US')} cached)` +
    ` / ${output.toLocaleString('en-US')} output tokens` +
    ` — $${result.costUsd.toFixed(4)}` +
    ` — ${formatDuration(result.durationMs)}` +
    ` — ${result.status}`;

  if (result.errorMessage) {
    line += ` (${result.errorMessage.slice(0, ERROR_MESSAGE_HEAD_LENGTH)})`;
  }
  return line;
}

export function printTheorySummary(
  results: readonly TheoryCellResult[],
  totalCostUsd: number,
  totalDurationMs: number,
): void {
  for (const result of results) {
    process.stdout.write(`${formatTheoryCellLine(result)}\n`);
  }

  const succeeded = results.filter((r) => r.status === 'succeeded').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped-cost-cap').length;
  const topicsInserted = results.reduce((sum, r) => sum + r.insertedCount, 0);
  const totalUsage = results.reduce<ClaudeUsageBreakdown>(
    (acc, r) => addUsage(acc, r.tokenUsage),
    ZERO_USAGE,
  );
  const totalInput =
    totalUsage.inputTokens +
    totalUsage.cacheCreationInputTokens +
    totalUsage.cacheReadInputTokens;
  const totalCached = totalUsage.cacheReadInputTokens;

  process.stdout.write('\n═══ Total ═══\n');
  process.stdout.write(
    `Cells: ${results.length} (${succeeded} succeeded, ${failed} failed, ${skipped} skipped)\n`,
  );
  process.stdout.write(
    `Topics inserted: ${topicsInserted.toLocaleString('en-US')}\n`,
  );
  process.stdout.write(
    `Total input tokens: ${totalInput.toLocaleString('en-US')} (cached: ${totalCached.toLocaleString('en-US')})\n`,
  );
  process.stdout.write(
    `Total output tokens: ${totalUsage.outputTokens.toLocaleString('en-US')}\n`,
  );
  process.stdout.write(`Estimated cost: $${totalCostUsd.toFixed(4)}\n`);
  process.stdout.write(`Total runtime: ${formatDuration(totalDurationMs)}\n`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const args = parseTheoryGenerateArgs(argv);

  if (process.env['NODE_ENV'] === 'production' && !args.allowProd) {
    console.error(
      'Refusing to run in production. Pass --allow-prod or use the Phase 4 Lambda path.',
    );
    process.exit(1);
  }

  // Bridge SIGINT to an AbortController. Each `main()` invocation gets its
  // own controller so test suites that call `main()` multiple times don't
  // inherit an aborted signal from a prior run.
  const abortController = new AbortController();
  process.on('SIGINT', () => abortController.abort());
  const signal = abortController.signal;

  const cells = resolveTheoryCells(args, ALL_CURRICULA);

  if (args.dryRun) {
    printDryRunSummary(cells, args);
    return;
  }

  const client: Anthropic =
    process.env['MOCK_CLAUDE'] === '1'
      ? createTheoryMockClient()
      : createClaudeClient(requireEnv('ANTHROPIC_API_KEY'));
  const db = createDb(requireEnv('DATABASE_URL'));

  const limit = pLimit(args.concurrency);
  let totalCostUsd = 0;
  const startedAt = Date.now();

  // Cell-level cost cap: cells dispatched after the cap is hit are short-
  // circuited without making any DB or Claude call. Cells already in flight
  // run to completion — the per-call cost is added to `totalCostUsd` only
  // after `runOneTheoryCell` resolves.
  const runWithCostCap = async (cell: TheoryCell): Promise<TheoryCellResult> => {
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
      };
    }
    const result = await runOneTheoryCell({
      db,
      client,
      cell,
      args: {
        batchSeed: args.batchSeed,
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

  printTheorySummary(results, totalCostUsd, Date.now() - startedAt);

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

const isDirectRun =
  process.argv[1] !== undefined &&
  process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('generate-theory failed:', err);
    process.exit(1);
  });
}
