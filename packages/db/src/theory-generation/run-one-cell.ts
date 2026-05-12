/**
 * Per-cell orchestration for theory generation. Opens an audit row, calls
 * `generateTheoryTopic`, validates the draft via `validateTheoryDraft`,
 * routes the validation result through `routeTheoryValidationResult`, and
 * INSERTs the theory_topics row (or skips it for the rejected branch).
 * Cell-isolated try/catch — a single bad cell never halts the run.
 *
 * Structural mirror of `packages/db/src/generation/run-one-cell.ts` minus
 * the per-ordinal loop and dedup-retry helper — theory is one page per
 * cell (Req 5.1), so there is no batch iteration. The partial unique
 * index `theory_topics_pool_lookup_idx` on
 * `(language, grammar_point_key) WHERE review_status IN
 * ('auto-approved', 'manual-approved')` is consulted only on the
 * auto-approved branch via `.onConflictDoNothing()`; flagged and rejected
 * rows are not covered by the index.
 *
 * Three terminal router branches (Req 4.3 / 4.4 / 4.5):
 *   - 'rejected'     → no INSERT into theory_topics; audit row closes
 *                      with rejected=true.
 *   - 'flagged'      → INSERT with review_status='flagged'; audit row
 *                      closes with flagged=true. The partial unique
 *                      index does NOT fire on flagged rows (its
 *                      predicate matches only approved review statuses).
 *   - 'auto-approved'→ INSERT with review_status='auto-approved' +
 *                      `.onConflictDoNothing()`; on dedup collision the
 *                      audit row closes with the Phase 2 cell-already-
 *                      filled message (Req 4.7).
 *
 * Two SIGINT recheck points (Req 4.8) — once between generator and
 * validator (so an abort skips the validator's tokens) and once between
 * validator and INSERT (so an abort skips the DB write but reports
 * accumulated generator + validator tokens honestly).
 *
 * The `auditRowExists` flag on `failClosed` distinguishes precheck
 * failures (audit row never INSERTed) from in-flight failures (audit row
 * needs to be UPDATEd to 'failed'). Same shape as the exercise side.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  GENERATION_MODEL,
  ZERO_USAGE,
  addUsage,
  estimateCostUsd,
  generateTheoryTopic,
  validateTheoryDraft,
  type ClaudeUsageBreakdown,
  type TheoryGenerationSpec,
  type TheoryValidationResult,
} from '@language-drill/ai';
import { eq } from 'drizzle-orm';

import type { Db } from '../client';
import { assertValidTheoryCellKey } from '../lib/theory-cell-key';
import { theoryGenerationJobs, theoryTopics } from '../schema/index';

import type { TheoryCell } from './cells';
import { routeTheoryValidationResult } from './routing';

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

    // SIGINT recheck #1 — between generator and validator. If the user
    // aborted during the generator call we've already paid for those
    // tokens; report them honestly. Skipping the validator here is the
    // whole point of this recheck (Req 4.8 — don't pay for the validator
    // call when the user has signalled an abort).
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

    // 6. Validate the draft. On throw, the audit row is closed as
    //    'failed' carrying ONLY the generator's tokenUsage — we never
    //    received a usage breakdown for the validator call so we can't
    //    bill what we don't have a measurement for (Req 4.6).
    let validationResult: TheoryValidationResult;
    try {
      const { result, tokenUsage: validatorUsage } = await validateTheoryDraft(
        client,
        draft,
        spec,
      );
      validationResult = result;
      tokenUsage = addUsage(tokenUsage, validatorUsage);
    } catch (err) {
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

    // SIGINT recheck #2 — between validator and INSERT. Both Claude
    // calls have completed; abort skips only the DB write. Accumulated
    // tokens (generator + validator) are reported honestly.
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

    // 7. Route the validation result. The router is pure — no I/O — so
    //    it cannot throw and does not need its own SIGINT recheck.
    const decision = routeTheoryValidationResult(validationResult);

    const costUsd = estimateCostUsd(tokenUsage);
    const inputTokensUsed =
      tokenUsage.inputTokens +
      tokenUsage.cacheCreationInputTokens +
      tokenUsage.cacheReadInputTokens;

    // 8. Switch on the three terminal router branches.
    switch (decision.reviewStatus) {
      case 'rejected': {
        // 8a. Rejected — no INSERT into theory_topics. Audit row closes
        //     with status='succeeded' and rejected=true (Req 4.3). The
        //     run was technically a success (we got a validator verdict);
        //     the rejected boolean carries the verdict's outcome.
        await db
          .update(theoryGenerationJobs)
          .set({
            status: 'succeeded',
            finishedAt: new Date(),
            approved: false,
            flagged: false,
            rejected: true,
            inputTokensUsed,
            outputTokensUsed: tokenUsage.outputTokens,
            costUsdEstimate: costUsd.toFixed(4),
          })
          .where(eq(theoryGenerationJobs.id, jobId));

        return {
          cell,
          jobId,
          status: 'succeeded',
          insertedCount: 0,
          skippedCount: 0,
          tokenUsage,
          costUsd,
          durationMs: Date.now() - startedAt,
        };
      }

      case 'flagged': {
        // 8b. Flagged — INSERT with review_status='flagged'. The partial
        //     unique index `theory_topics_pool_lookup_idx` is predicated
        //     on `review_status IN ('auto-approved', 'manual-approved')`,
        //     so a flagged INSERT cannot collide with it. No
        //     `.onConflictDoNothing()` needed (Req 4.4).
        await db.insert(theoryTopics).values({
          id: draft.id,
          language: cell.language,
          grammarPointKey: cell.grammarPoint.key,
          topicId: draft.topicId,
          cefrLevel: cell.cefrLevel,
          contentJson: draft.contentJson,
          generationSource: 'claude-realtime',
          modelId: GENERATION_MODEL,
          reviewStatus: 'flagged',
          qualityScore: validationResult.qualityScore,
          flaggedReasons: decision.flaggedReasons,
          generatedAt: new Date(),
        });

        await db
          .update(theoryGenerationJobs)
          .set({
            status: 'succeeded',
            finishedAt: new Date(),
            approved: false,
            flagged: true,
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
      }

      case 'auto-approved': {
        // 8c. Auto-approved — INSERT with `.onConflictDoNothing()` on
        //     the partial unique index. A 0-row return signals that the
        //     cell was already filled by a prior approved row (Req 4.7).
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
            qualityScore: validationResult.qualityScore,
            flaggedReasons: null,
            generatedAt: new Date(),
          })
          .onConflictDoNothing()
          .returning({ id: theoryTopics.id });

        if (inserted.length === 0) {
          // Dedup skip — partial-index collision, cell already filled.
          // Preserved from Phase 2 verbatim (Req 4.7).
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
      }
    }
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
