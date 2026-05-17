/**
 * Per-ordinal "validate → insert → retry-on-dedup" path. Extracted from
 * `run-one-cell.ts` (Phase 4 originally) into its own module so the parallel
 * outcome pool can mock this function without circular-import pain.
 *
 * Contract:
 *   - One call per ordinal. Worker pools (see `outcome-pool.ts`) fan out
 *     across ordinals; this function's INTERNAL attempt loop stays sequential
 *     because dedup-detection requires observing the INSERT collision before
 *     deciding whether to retry.
 *   - Each retry rebuilds the draft via `runRetryGeneration` with a bumped
 *     `batchSeed::retry-N` so the deterministic UUID derivation produces a
 *     fresh id distinct from the original and prior retries.
 *   - Phase A's pre-computed first-validation (from the validator pool) is
 *     consumed on attempt 0 when supplied; attempts 1+ always re-validate
 *     live.
 *   - Token usage from EVERY validator and retry-generator call is folded
 *     into the returned `extraUsage`. The caller (`runOneCell`) adds this
 *     to `combinedUsage` post-walk.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  GENERATION_MODEL,
  ZERO_USAGE,
  addUsage,
  canonicalSurface,
  generateBatch,
  validateDraft,
  type ClaudeUsageBreakdown,
  type ExerciseDraft,
  type GenerationSpec,
  type ValidateDraftResult,
  type ValidationResult,
} from '@language-drill/ai';

import type { Db } from '../client';
import { deterministicUuid } from '../lib/deterministic-uuid';
import { exerciseTags, exercises } from '../schema/index';

import type { Cell } from './cells';
import { routeValidationResult } from './routing';

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
   *  included here). */
  extraUsage: ClaudeUsageBreakdown;
  /** Additional drafts Claude produced via retries (0..MAX_DEDUP_RETRIES). */
  extraProduced: number;
  /** 1 (original validator call) + N retry validator calls. */
  validatedCount: number;
};

export type ValidateAndInsertOpts = {
  db: Db;
  client: Anthropic;
  spec: GenerationSpec;
  draft: ExerciseDraft;
  ordinal: number;
  cell: Cell;
  args: {
    count: number;
    batchSeed: string;
    topicDomain: string | null;
    maxCostUsd: number;
  };
  generatedAt: Date;
  signal?: AbortSignal;
  /**
   * Phase A's pre-computed first validation. When supplied, attempt 0 of the
   * retry loop uses this instead of calling `validateDraft` again. Attempts
   * 1+ (dedup retries) always call `validateDraft` live.
   */
  precomputedFirstValidation?: ValidateDraftResult;
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
  signal: AbortSignal | undefined,
): Promise<{ draft: ExerciseDraft; usage: ClaudeUsageBreakdown }> {
  if (signal?.aborted) throw new Error('Aborted by user (SIGINT)');
  const retrySpec: GenerationSpec = {
    ...spec,
    count: 1,
    batchSeed: `${spec.batchSeed}::retry-${retryN}`,
  };
  const result = await generateBatch(client, retrySpec);
  return { draft: result.drafts[0], usage: result.tokenUsage };
}

export async function validateAndInsertWithRetry(
  opts: ValidateAndInsertOpts,
): Promise<DraftOutcome> {
  let extraUsage: ClaudeUsageBreakdown = ZERO_USAGE;
  let extraProduced = 0;
  let validatedCount = 0;

  // Attempt 0 = the original draft from the cell's batch. Subsequent attempts
  // are dedup retries.
  let currentDraft: ExerciseDraft = opts.draft;
  let firstAttemptDeduped = false;

  for (let attempt = 0; attempt <= MAX_DEDUP_RETRIES; attempt++) {
    if (opts.signal?.aborted) throw new Error('Aborted by user (SIGINT)');

    // Validate. Every validator call's usage folds into extraUsage — there
    // is NO conditional guard on attempt index (the bug the design validator
    // caught in Phase 3). Token-totals regression test in Task 25 enforces this.
    // Attempt 0 consumes Phase A's pre-computed result when supplied; later
    // attempts (dedup-retry path) always call validateDraft live.
    if (opts.signal?.aborted) throw new Error('Aborted by user (SIGINT)');
    let result: ValidationResult;
    let valUsage: ClaudeUsageBreakdown;
    if (attempt === 0 && opts.precomputedFirstValidation) {
      ({ result, tokenUsage: valUsage } = opts.precomputedFirstValidation);
    } else {
      ({ result, tokenUsage: valUsage } = await validateDraft(
        opts.client,
        currentDraft,
        opts.spec,
        opts.signal,
      ));
    }
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
          opts.signal,
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
        // Safe narrow: `routeValidationResult` never returns 'manual-approved'
        // (only the review CLI's `tryApprove` sets that). The 'rejected' case
        // is already handled by the early return above.
        terminalReviewStatus: decision.reviewStatus as 'auto-approved' | 'flagged',
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
        opts.signal,
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
