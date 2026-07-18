/**
 * Per-cell orchestration for theory generation. Opens an audit row, calls
 * `generateTheoryTopic`, validates the draft via `validateTheoryDraft`,
 * routes the validation result through `routeTheoryValidationResult`, and
 * INSERTs the theory_topics row (or skips it for the rejected branch).
 * Cell-isolated try/catch — a single bad cell never halts the run.
 *
 * A non-approved first verdict (flagged or rejected) triggers ONE
 * feedback-driven regenerate: the validator's reasons are fed back into the
 * generator's user prompt, the second draft is re-validated, and the better
 * of the two outcomes wins (approved > flagged > rejected, then
 * qualityScore; ties keep the first draft). The retry is skipped when the
 * projected cost would exceed `args.maxCostUsd` and is best-effort — any
 * throw inside it preserves the first outcome.
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
 * Three SIGINT recheck points (Req 4.8) — between generator and validator
 * (an abort skips the validator's tokens), between validator and the
 * feedback retry, and after the retry ahead of the INSERT (an abort skips
 * the DB write but reports accumulated tokens honestly).
 *
 * The `auditRowExists` flag on `failClosed` distinguishes precheck
 * failures (audit row never INSERTed) from in-flight failures (audit row
 * needs to be UPDATEd to 'failed'). Same shape as the exercise side.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  OPUS_4_8_PRICING,
  THEORY_GENERATION_MODEL,
  ZERO_USAGE,
  addUsage,
  estimateCostUsd,
  estimateCostUsdAt,
  generateTheoryTopic,
  TheoryDraftMalformedError,
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
import {
  routeTheoryValidationResult,
  type TheoryRoutingDecision,
} from './routing';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** theory_generation_jobs.error_message column truncates at 1000 chars. */
const ERROR_MESSAGE_MAX_LENGTH = 1000;

/**
 * Mixed-model cost: generator tokens bill at Opus list pricing
 * (`THEORY_GENERATION_MODEL` = claude-opus-4-8), validator tokens at Sonnet.
 */
function theoryCellCostUsd(
  genUsage: ClaudeUsageBreakdown,
  valUsage: ClaudeUsageBreakdown,
): number {
  const raw =
    estimateCostUsdAt(OPUS_4_8_PRICING, genUsage) + estimateCostUsd(valUsage);
  return Math.round(raw * 10000) / 10000;
}

/** Outcome ordering for the feedback-retry's best-of-two selection. */
const REVIEW_STATUS_RANK: Record<
  TheoryRoutingDecision['reviewStatus'],
  number
> = {
  rejected: 0,
  flagged: 1,
  'auto-approved': 2,
};

/**
 * True when the retry's outcome should replace the first attempt's:
 * a strictly better review status, or the same status with a strictly
 * higher quality score. Ties keep the first draft (stable preference).
 */
function retryOutcomeIsBetter(
  retryDecision: TheoryRoutingDecision,
  retryValidation: TheoryValidationResult,
  firstDecision: TheoryRoutingDecision,
  firstValidation: TheoryValidationResult,
): boolean {
  const rankDelta =
    REVIEW_STATUS_RANK[retryDecision.reviewStatus] -
    REVIEW_STATUS_RANK[firstDecision.reviewStatus];
  if (rankDelta !== 0) return rankDelta > 0;
  return retryValidation.qualityScore > firstValidation.qualityScore;
}

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
  /** Total usage across generator + validator calls (incl. any feedback retry). */
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
      genUsage: ZERO_USAGE,
      valUsage: ZERO_USAGE,
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
      genUsage: ZERO_USAGE,
      valUsage: ZERO_USAGE,
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
      genUsage: ZERO_USAGE,
      valUsage: ZERO_USAGE,
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

  // Generator and validator usage are tracked separately because they run
  // on different models: the generator bills at Opus list pricing, the
  // validator at Sonnet. `addUsage(genUsage, valUsage)` is the audit total.
  let genUsage: ClaudeUsageBreakdown = ZERO_USAGE;
  let valUsage: ClaudeUsageBreakdown = ZERO_USAGE;

  // 4. Wrap the generation + INSERT steps in an outer try/catch so any
  //    unexpected throw still closes the audit row.
  try {
    // SIGINT recheck before the Claude call.
    if (signal?.aborted) {
      return failClosed({
        cell,
        jobId,
        genUsage: ZERO_USAGE,
      valUsage: ZERO_USAGE,
        durationMs: Date.now() - startedAt,
        errorMessage: 'Aborted by user (SIGINT)',
        auditRowExists: true,
        db,
      });
    }

    // 5. Call the generator. On a malformed-draft throw the audit row is
    //    closed as 'failed' carrying the tokens every attempt burned —
    //    `TheoryDraftMalformedError.tokenUsage` is the sum across all retries
    //    (Req 2.1, 2.2, 2.3). Any other throw has no usage breakdown to bill,
    //    so it falls back to ZERO_USAGE.
    let draft;
    try {
      const result = await generateTheoryTopic(client, spec);
      genUsage = result.tokenUsage;
      draft = result.draft;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failureUsage =
        err instanceof TheoryDraftMalformedError ? err.tokenUsage : ZERO_USAGE;
      return failClosed({
        cell,
        jobId,
        genUsage: failureUsage,
        valUsage: ZERO_USAGE,
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
        genUsage,
        valUsage,
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
      valUsage = addUsage(valUsage, validatorUsage);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return failClosed({
        cell,
        jobId,
        genUsage,
        valUsage,
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
        genUsage,
        valUsage,
        durationMs: Date.now() - startedAt,
        errorMessage: 'Aborted by user (SIGINT)',
        auditRowExists: true,
        db,
      });
    }

    // 7. Route the validation result. The router is pure — no I/O — so
    //    it cannot throw and does not need its own SIGINT recheck.
    let decision = routeTheoryValidationResult(validationResult);

    // 7b. One feedback-driven regenerate on a non-approved first verdict.
    //     The validator's reasons go back into the generator's user prompt;
    //     the second draft is re-validated and the better of the two
    //     outcomes wins (approved > flagged > rejected, then qualityScore).
    //     Guards: at most one retry, skip when the projected second attempt
    //     would blow the per-cell cost cap, skip on abort. A throw anywhere
    //     in the retry keeps the first outcome — the retry is best-effort
    //     and must never lose an already-materialized flagged draft.
    if (decision.reviewStatus !== 'auto-approved' && !signal?.aborted) {
      const costSoFar = theoryCellCostUsd(genUsage, valUsage);
      if (costSoFar * 2 <= args.maxCostUsd) {
        console.log(
          JSON.stringify({
            level: 'info',
            cellKey: cell.cellKey,
            firstVerdict: decision.reviewStatus,
            message: 'theory draft not approved — regenerating with validator feedback',
          }),
        );
        try {
          const retryGen = await generateTheoryTopic(client, spec, {
            validatorFeedback: decision.flaggedReasons,
          });
          genUsage = addUsage(genUsage, retryGen.tokenUsage);
          if (!signal?.aborted) {
            const { result: retryValidation, tokenUsage: retryValUsage } =
              await validateTheoryDraft(client, retryGen.draft, spec);
            valUsage = addUsage(valUsage, retryValUsage);
            const retryDecision = routeTheoryValidationResult(retryValidation);
            if (
              retryOutcomeIsBetter(
                retryDecision,
                retryValidation,
                decision,
                validationResult,
              )
            ) {
              draft = retryGen.draft;
              validationResult = retryValidation;
              decision = retryDecision;
            }
          }
        } catch (err) {
          // Bill malformed retry attempts honestly; otherwise swallow — the
          // first draft's verdict stands.
          if (err instanceof TheoryDraftMalformedError) {
            genUsage = addUsage(genUsage, err.tokenUsage);
          }
          console.log(
            JSON.stringify({
              level: 'warn',
              cellKey: cell.cellKey,
              error: err instanceof Error ? err.message : String(err),
              message: 'feedback retry failed — keeping first verdict',
            }),
          );
        }
      }
    }

    // SIGINT recheck #3 — the feedback retry can add two more Claude calls
    // after recheck #2; keep the invariant that an abort never reaches the
    // DB write while still reporting every token the retry burned.
    if (signal?.aborted) {
      return failClosed({
        cell,
        jobId,
        genUsage,
        valUsage,
        durationMs: Date.now() - startedAt,
        errorMessage: 'Aborted by user (SIGINT)',
        auditRowExists: true,
        db,
      });
    }

    const tokenUsage = addUsage(genUsage, valUsage);
    const costUsd = theoryCellCostUsd(genUsage, valUsage);
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
        const rawMessage =
          decision.flaggedReasons.length > 0
            ? decision.flaggedReasons.join('; ')
            : 'rejected (no reasons reported)';
        const errorMessage = rawMessage.slice(0, ERROR_MESSAGE_MAX_LENGTH);
        await db
          .update(theoryGenerationJobs)
          .set({
            status: 'succeeded',
            finishedAt: new Date(),
            approved: false,
            flagged: false,
            rejected: true,
            errorMessage,
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
          modelId: THEORY_GENERATION_MODEL,
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
            modelId: THEORY_GENERATION_MODEL,
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
      genUsage,
      valUsage,
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
  /** Generator-side usage (bills at Opus pricing). */
  genUsage: ClaudeUsageBreakdown;
  /** Validator-side usage (bills at Sonnet pricing). */
  valUsage: ClaudeUsageBreakdown;
  durationMs: number;
  errorMessage: string;
  auditRowExists: boolean;
  db: Db;
}): Promise<TheoryCellResult> {
  const truncatedMessage = opts.errorMessage.slice(0, ERROR_MESSAGE_MAX_LENGTH);

  // Best-effort token accounting (Req 2.2): record the tokens the failed
  // attempt(s) burned instead of leaving the columns NULL. Fail-open
  // (NFR Reliability) — if the (pure) cost math ever throws, the cell still
  // records as 'failed' with the usage columns left unset (NULL).
  const totalUsage = addUsage(opts.genUsage, opts.valUsage);
  let inputTokensUsed: number | undefined;
  let outputTokensUsed: number | undefined;
  let costUsdEstimate: string | undefined;
  let costUsd = 0;
  try {
    inputTokensUsed =
      totalUsage.inputTokens +
      totalUsage.cacheCreationInputTokens +
      totalUsage.cacheReadInputTokens;
    outputTokensUsed = totalUsage.outputTokens;
    costUsd = theoryCellCostUsd(opts.genUsage, opts.valUsage);
    costUsdEstimate = costUsd.toFixed(4);
  } catch {
    // Leave usage columns NULL; never let accounting fail the run.
  }

  if (opts.auditRowExists) {
    await opts.db
      .update(theoryGenerationJobs)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: truncatedMessage,
        inputTokensUsed,
        outputTokensUsed,
        costUsdEstimate,
      })
      .where(eq(theoryGenerationJobs.id, opts.jobId));
  }
  return {
    cell: opts.cell,
    jobId: opts.jobId,
    status: 'failed',
    insertedCount: 0,
    skippedCount: 0,
    tokenUsage: totalUsage,
    costUsd,
    durationMs: opts.durationMs,
    errorMessage: truncatedMessage,
  };
}
