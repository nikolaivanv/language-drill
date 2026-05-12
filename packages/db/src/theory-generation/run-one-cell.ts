/**
 * Per-cell orchestration for theory generation. Opens an audit row, calls
 * `generateTheoryTopic`, INSERTs the resulting draft into `theory_topics`,
 * closes the audit row. Cell-isolated try/catch — a single bad cell never
 * halts the run.
 *
 * Structural mirror of `packages/db/src/generation/run-one-cell.ts` minus
 * three things that don't exist for theory:
 *   1. No per-ordinal loop. Theory is one page per cell (Req 5.1) — there
 *      is no `count` arg and no batch iteration.
 *   2. No validator branch. Phase 2 routes every draft to
 *      `'auto-approved'` (Phase 3 will introduce the validator + the
 *      `'flagged' | 'rejected'` review-status branches).
 *   3. No dedup retry helper. The single partial unique index
 *      `theory_topics_pool_lookup_idx` on
 *      `(language, grammar_point_key) WHERE review_status IN
 *      ('auto-approved', 'manual-approved')` returns 0 rows from
 *      `.onConflictDoNothing()` when a cell is already filled; the
 *      orchestrator surfaces that as a `skipped-cost-cap`-style success
 *      with `skippedCount: 1` rather than re-rolling.
 *
 * The `auditRowExists` flag on `failClosed` distinguishes precheck
 * failures (audit row never INSERTed) from in-flight failures (audit row
 * needs to be UPDATEd to 'failed'). Same shape as the exercise side.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  GENERATION_MODEL,
  ZERO_USAGE,
  estimateCostUsd,
  generateTheoryTopic,
  type ClaudeUsageBreakdown,
  type TheoryGenerationSpec,
} from '@language-drill/ai';
import { eq } from 'drizzle-orm';

import type { Db } from '../client';
import { assertValidTheoryCellKey } from '../lib/theory-cell-key';
import { theoryGenerationJobs, theoryTopics } from '../schema/index';

import type { TheoryCell } from './cells';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** theory_generation_jobs.error_message column truncates at 1000 chars. */
const ERROR_MESSAGE_MAX_LENGTH = 1000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Caller-shape: `runOneTheoryCell` takes a single options object with
 * caller-supplied `jobId` + `trigger` + an optional abort signal. Mirrors
 * `RunOneCellInput` on the exercise side minus the `count` / `topicDomain`
 * args that don't apply to theory.
 */
export type RunOneTheoryCellInput = {
  db: Db;
  client: Anthropic;
  cell: TheoryCell;
  args: {
    batchSeed: string;
    maxCostUsd: number;
  };
  /** Caller-supplied audit-row id. CLI: `randomUUID()`. Scheduler: `deterministicUuid([cellKey, batchSeed].join('|'))`. */
  jobId: string;
  /** Matches the `theory_generation_jobs.trigger` TS-enforced union. */
  trigger: 'cli' | 'scheduled' | 'admin';
  /**
   * Optional cooperative-cancellation signal. The CLI bridges its SIGINT
   * handler to `AbortController.signal`; the Phase 4 Lambda omits this.
   */
  signal?: AbortSignal;
};

/**
 * Per-cell result. Theory `insertedCount` / `skippedCount` are 0/1 (not
 * unbounded as on the exercise side) because theory generates one page
 * per cell.
 */
export type TheoryCellResult = {
  cell: TheoryCell;
  jobId: string;
  status: 'succeeded' | 'failed' | 'skipped-cost-cap';
  /** 1 when the theory page landed in `theory_topics`; 0 otherwise. */
  insertedCount: 0 | 1;
  /** 1 when the partial unique index rejected the INSERT (cell already filled). */
  skippedCount: 0 | 1;
  /** Generator usage from the single Claude call. */
  tokenUsage: ClaudeUsageBreakdown;
  costUsd: number;
  durationMs: number;
  errorMessage?: string;
};

// ---------------------------------------------------------------------------
// runOneTheoryCell
// ---------------------------------------------------------------------------

export async function runOneTheoryCell(
  input: RunOneTheoryCellInput,
): Promise<TheoryCellResult> {
  const { db, client, cell, args, jobId, trigger, signal } = input;
  const startedAt = Date.now();

  // 1. SIGINT precheck — never even INSERT the audit row if the user aborted
  //    before we started.
  if (signal?.aborted) {
    return failClosed({
      cell,
      jobId,
      tokenUsage: ZERO_USAGE,
      durationMs: Date.now() - startedAt,
      errorMessage: 'Aborted by user (SIGINT)',
      auditRowExists: false,
      db,
    });
  }

  // 2. Defense-in-depth — `enumerateTheoryCells` builds the key from typed
  //    inputs and already calls this; an exception here means the cell
  //    builder drifted from the regex.
  try {
    assertValidTheoryCellKey(cell.cellKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failClosed({
      cell,
      jobId,
      tokenUsage: ZERO_USAGE,
      durationMs: Date.now() - startedAt,
      errorMessage: message,
      auditRowExists: false,
      db,
    });
  }

  // 3. Open the audit row in 'running' state. A PK collision means the
  //    caller is re-using a `jobId` that already ran — refuse rather than
  //    silently overwriting a prior run's status.
  try {
    await db.insert(theoryGenerationJobs).values({
      id: jobId,
      cellKey: cell.cellKey,
      status: 'running',
      trigger,
    });
  } catch {
    return failClosed({
      cell,
      jobId,
      tokenUsage: ZERO_USAGE,
      durationMs: Date.now() - startedAt,
      errorMessage: 'Audit row id collision (job already ran)',
      auditRowExists: false,
      db,
    });
  }

  const spec: TheoryGenerationSpec = {
    language: cell.language,
    cefrLevel: cell.cefrLevel,
    grammarPoint: cell.grammarPoint,
    batchSeed: args.batchSeed,
  };

  let tokenUsage: ClaudeUsageBreakdown = ZERO_USAGE;

  // 4. Wrap the generation + INSERT steps in an outer try/catch so any
  //    unexpected throw still closes the audit row.
  try {
    // SIGINT recheck before the Claude call.
    if (signal?.aborted) {
      return failClosed({
        cell,
        jobId,
        tokenUsage: ZERO_USAGE,
        durationMs: Date.now() - startedAt,
        errorMessage: 'Aborted by user (SIGINT)',
        auditRowExists: true,
        db,
      });
    }

    // 5. Call the generator. On throw, the audit row is closed as 'failed'
    //    with `tokenUsage: ZERO_USAGE` — we never received a usage breakdown
    //    so we can't bill anything.
    let draft;
    try {
      const result = await generateTheoryTopic(client, spec);
      tokenUsage = result.tokenUsage;
      draft = result.draft;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return failClosed({
        cell,
        jobId,
        tokenUsage: ZERO_USAGE,
        durationMs: Date.now() - startedAt,
        errorMessage: message,
        auditRowExists: true,
        db,
      });
    }

    // SIGINT recheck after the Claude call. If the user aborted during the
    // call we've already paid for the tokens — report them honestly in the
    // failure result rather than zeroing them out.
    if (signal?.aborted) {
      return failClosed({
        cell,
        jobId,
        tokenUsage,
        durationMs: Date.now() - startedAt,
        errorMessage: 'Aborted by user (SIGINT)',
        auditRowExists: true,
        db,
      });
    }

    // 6. INSERT the draft. `.onConflictDoNothing()` on the partial unique
    //    index `theory_topics_pool_lookup_idx` returns 0 rows when the cell
    //    is already filled by a prior approved/manual-approved row — Phase 2
    //    surfaces that as a 'succeeded' result with `skippedCount: 1` rather
    //    than re-rolling.
    const generatedAt = new Date();
    const inserted = await db
      .insert(theoryTopics)
      .values({
        id: draft.id,
        language: cell.language,
        grammarPointKey: cell.grammarPoint.key,
        topicId: draft.topicId,
        cefrLevel: cell.cefrLevel,
        contentJson: draft.contentJson,
        generationSource: 'claude-realtime',
        modelId: GENERATION_MODEL,
        reviewStatus: 'auto-approved',
        qualityScore: null,
        flaggedReasons: null,
        generatedAt,
      })
      .onConflictDoNothing()
      .returning({ id: theoryTopics.id });

    const costUsd = estimateCostUsd(tokenUsage);
    const inputTokensUsed =
      tokenUsage.inputTokens +
      tokenUsage.cacheCreationInputTokens +
      tokenUsage.cacheReadInputTokens;

    // 7a. Dedup skip — partial-index collision, cell already filled.
    if (inserted.length === 0) {
      const skipMessage = 'cell already filled (partial index collision)';
      await db
        .update(theoryGenerationJobs)
        .set({
          status: 'succeeded',
          finishedAt: new Date(),
          approved: false,
          flagged: false,
          rejected: false,
          inputTokensUsed,
          outputTokensUsed: tokenUsage.outputTokens,
          costUsdEstimate: costUsd.toFixed(4),
          errorMessage: skipMessage,
        })
        .where(eq(theoryGenerationJobs.id, jobId));

      return {
        cell,
        jobId,
        status: 'succeeded',
        insertedCount: 0,
        skippedCount: 1,
        tokenUsage,
        costUsd,
        durationMs: Date.now() - startedAt,
        errorMessage: skipMessage,
      };
    }

    // 7b. Success — the row landed. Phase 2 routes every draft to
    //     `approved: true` because there is no validator yet (Phase 3).
    await db
      .update(theoryGenerationJobs)
      .set({
        status: 'succeeded',
        finishedAt: new Date(),
        approved: true,
        flagged: false,
        rejected: false,
        inputTokensUsed,
        outputTokensUsed: tokenUsage.outputTokens,
        costUsdEstimate: costUsd.toFixed(4),
      })
      .where(eq(theoryGenerationJobs.id, jobId));

    return {
      cell,
      jobId,
      status: 'succeeded',
      insertedCount: 1,
      skippedCount: 0,
      tokenUsage,
      costUsd,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    // Defensive outer catch — any unexpected throw (DB error, etc.) still
    // produces a `failClosed` result. The audit row was INSERTed at step 3.
    const message = err instanceof Error ? err.message : String(err);
    return failClosed({
      cell,
      jobId,
      tokenUsage,
      durationMs: Date.now() - startedAt,
      errorMessage: message,
      auditRowExists: true,
      db,
    });
  }
}

// ---------------------------------------------------------------------------
// failClosed — failure path shared by precheck + generator + dedup failures.
// ---------------------------------------------------------------------------

async function failClosed(opts: {
  cell: TheoryCell;
  jobId: string;
  tokenUsage: ClaudeUsageBreakdown;
  durationMs: number;
  errorMessage: string;
  auditRowExists: boolean;
  db: Db;
}): Promise<TheoryCellResult> {
  const truncatedMessage = opts.errorMessage.slice(0, ERROR_MESSAGE_MAX_LENGTH);
  if (opts.auditRowExists) {
    await opts.db
      .update(theoryGenerationJobs)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: truncatedMessage,
      })
      .where(eq(theoryGenerationJobs.id, opts.jobId));
  }
  return {
    cell: opts.cell,
    jobId: opts.jobId,
    status: 'failed',
    insertedCount: 0,
    skippedCount: 0,
    tokenUsage: opts.tokenUsage,
    costUsd: estimateCostUsd(opts.tokenUsage),
    durationMs: opts.durationMs,
    errorMessage: truncatedMessage,
  };
}
