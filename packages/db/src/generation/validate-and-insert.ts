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
  ExerciseType,
  type GenerationReason,
  GenerationReasonCode,
} from '@language-drill/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  GENERATION_MODEL,
  ZERO_USAGE,
  addUsage,
  canonicalSurface,
  generateBatch,
  getCurrentLlmTraceContext,
  loadFrequency,
  validateDraft,
  withLlmTrace,
  type ClaudeUsageBreakdown,
  type ExerciseDraft,
  type GenerationSpec,
  type MalformedDraft,
  type ValidateDraftResult,
  type ValidationResult,
} from '@language-drill/ai';

import type { Db } from '../client';
import { deterministicUuid } from '../lib/deterministic-uuid';
import { exerciseTags, exercises } from '../schema/index';

import type { Cell } from './cells';
import { applicableCoverageTags } from './coverage-tags';
import { applyDeterministicChecks } from './deterministic-checks';
import { routeValidationResult } from './routing';

const MAX_DEDUP_RETRIES = 3;

/**
 * R6 — maximum approved/flagged `vocab_recall` exercises permitted per
 * `expectedWord` within a single cell. The `word::cue` dedup key (task 21)
 * lets the same word recur with a different retrieval cue; this count cap
 * stops context variation from collapsing vocabulary breadth — once a word
 * holds N exercises, a fresh draft for it is treated as a collision and the
 * generator is asked for a different word. Exported so the prior-surface
 * fetch (`run-one-cell`) can flag at-cap words as the avoid-set with the same
 * threshold (task 23).
 */
export const VOCAB_MAX_PER_WORD = 4;

/**
 * Counts the approved/flagged `vocab_recall` rows already stored for
 * `(cell, expectedWord)`. Scoped to exactly the rows the partial index
 * `exercises_vocab_word_idx` covers (review_status IN auto-approved /
 * manual-approved / flagged), so the count is index-backed. Drives the R6
 * per-word cap below.
 */
async function countApprovedForWord(
  db: Db,
  cell: Cell,
  expectedWord: string,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(exercises)
    .where(
      and(
        eq(exercises.language, cell.language),
        eq(exercises.difficulty, cell.cefrLevel),
        eq(exercises.type, cell.exerciseType),
        eq(exercises.grammarPointKey, cell.grammarPoint.key),
        eq(sql`content_json->>'expectedWord'`, expectedWord),
        inArray(exercises.reviewStatus, [
          'auto-approved',
          'manual-approved',
          'flagged',
        ]),
      ),
    );
  return rows[0]?.n ?? 0;
}

/**
 * Outcome of a single regeneration attempt. `ok: true` means the generator
 * produced a parseable draft; `ok: false` means Claude returned a tool
 * call that the parser rejected (the draft landed in `result.malformedDrafts`
 * instead of `result.drafts`).
 *
 * Both variants carry `usage` so the caller can fold the wasted-call cost
 * into `extraUsage` regardless of whether the retry yielded a usable draft.
 * Before this discriminated union, `runRetryGeneration` returned
 * `{ draft: undefined, usage }` on parser failures, and the caller crashed
 * on `currentDraft.contentJson`. The R5 fix is to make the failure visible
 * at the type level so the call sites must handle it explicitly.
 */
export type RetryOutcome =
  | { ok: true; draft: ExerciseDraft; usage: ClaudeUsageBreakdown }
  | { ok: false; malformed: MalformedDraft; usage: ClaudeUsageBreakdown };

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
  /**
   * Set to `true` ONLY when `terminalStatus === 'rejected'` and the
   * rejection is due to a parser-failed retry at the last allowed slot
   * (the regenerated draft landed in `result.malformedDrafts` and no
   * retry budget remains). The caller (`runOneCell`) bumps
   * `CellResult.parserFailedCount` by 1 when this is `true`, so the
   * structured log surfaces parser-failed ordinals separately from
   * validator-rejected ones. R5.4.
   */
  parserFailedAtFinal?: boolean;
  /**
   * Set to `true` ONLY when this ordinal's FIRST validation (computed by the
   * parallel validator pool) was a parse-failed sentinel — the validator
   * returned a malformed tool call that raised a `ValidationParseError`
   * (R8.3). The ordinal terminates `rejected` without re-validating; the
   * caller (`runOneCell`) bumps `CellResult.validatorParseFailedCount` so the
   * structured log separates validator-parse failures from genuine vetoes
   * (mirrors `parserFailedAtFinal`, which counts *generator* parse failures).
   */
  validatorParseFailedAtFirst?: boolean;
  /**
   * The validator's rejection reasons for this discarded ordinal, set ONLY
   * when `terminalStatus === 'rejected'`. For a genuine validation veto this
   * is `RoutingDecision.flaggedReasons` (low-quality / context-spoils /
   * cultural / deterministic-harmony — always non-empty for the rejected
   * branch). For a parser-failure-at-final slot it is the synthetic
   * `[PARSER_FAILURE_REASON]`. `dedup-given-up` does NOT set this — search-
   * space exhaustion is tracked separately and is not a quality reason.
   * `runOneCell` folds these (keyed on `code`) into the per-cell
   * `rejectionReasonCounts` map.
   */
  rejectionReasons?: GenerationReason[];
};

/**
 * Synthetic rejection reason for an ordinal whose every retry slot produced a
 * parser failure (`parserFailedAtFinal`). Kept distinct from validator vetoes
 * (its own `parser-failure` code) so the reason distribution separates "Claude
 * emitted unparseable tool calls" from genuine content rejections.
 */
export const PARSER_FAILURE_REASON: GenerationReason = {
  code: GenerationReasonCode.ParserFailure,
};

/**
 * Synthetic rejection reason for an ordinal whose VALIDATOR returned a
 * malformed tool call on its first validation (a `ValidationParseError` caught
 * by `runValidatorPool`, R8). Kept distinct from `PARSER_FAILURE_REASON`
 * (a *generator* parse failure) via its own `validator-parse-failure` code so
 * the reason distribution separates "the validator emitted an unparseable
 * response" from genuine content vetoes.
 */
export const VALIDATOR_PARSE_FAILURE_REASON: GenerationReason = {
  code: GenerationReasonCode.ValidatorParseFailure,
};

/**
 * Builds the terminal outcome for an ordinal whose first validation (from the
 * validator pool) was a parse-failed sentinel (R8.3). Routes straight to
 * `rejected` WITHOUT re-validating: the validator already returned a malformed
 * response for this draft, and one bad response must cost at most one ordinal,
 * never the whole cell. `validatedCount` is 1 (the validator was invoked
 * once); the failed call's token usage is unrecoverable from the thrown
 * `ValidationParseError`, so `extraUsage` is zero.
 */
export function validatorParseFailedOutcome(): DraftOutcome {
  return {
    terminalStatus: 'rejected',
    validatorParseFailedAtFirst: true,
    rejectionReasons: [VALIDATOR_PARSE_FAILURE_REASON],
    extraUsage: ZERO_USAGE,
    extraProduced: 0,
    validatedCount: 1,
  };
}

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
 *
 * Returns a discriminated union so a parser-failed retry (where Claude's
 * tool call was malformed and the draft landed in `result.malformedDrafts`)
 * surfaces cleanly as `{ ok: false, malformed, usage }`. The caller folds
 * `usage` into `extraUsage` in both branches — the wasted call cost is
 * accounted for whether or not the draft was usable.
 */
async function runRetryGeneration(
  client: Anthropic,
  spec: GenerationSpec,
  retryN: number,
  signal: AbortSignal | undefined,
): Promise<RetryOutcome> {
  if (signal?.aborted) throw new Error('Aborted by user (SIGINT)');
  const retrySpec: GenerationSpec = {
    ...spec,
    count: 1,
    batchSeed: `${spec.batchSeed}::retry-${retryN}`,
  };
  const result = await generateBatch(client, retrySpec);
  if (result.drafts.length === 0) {
    // Parser failure: Claude responded but the tool call did not yield a
    // valid draft (malformed `correctAnswer`, missing required field, etc.).
    // The MalformedDraft carries the parser error message for logging.
    return {
      ok: false,
      malformed: result.malformedDrafts[0],
      usage: result.tokenUsage,
    };
  }
  return { ok: true, draft: result.drafts[0], usage: result.tokenUsage };
}

export async function validateAndInsertWithRetry(
  opts: ValidateAndInsertOpts,
): Promise<DraftOutcome> {
  // Per-ordinal Langfuse-trace scope (R8). Nests inside the cell-level
  // `withLlmTrace` wrap in `infra/lambda/src/generation/handler.ts:222` —
  // the parent scope already carries `feature: 'generate'`, env, prompt
  // version, jobId, cellKey, language, cefrLevel, exerciseType. This inner
  // scope contributes only `exerciseId` so every generator + validator +
  // retry call emitted by this ordinal's per-attempt loop shares the same
  // `exerciseId` join key in Langfuse. `opts.draft.id` is the deterministic
  // UUID for the ordinal (`deterministicUuid(spec | batchSeed | ordinal)`)
  // and matches the `exercises.id` primary key on a successful first-attempt
  // insert.
  //
  // CLI runs (`packages/db/scripts/generate-exercises.ts`) call into this
  // function without a parent `withLlmTrace` scope; in that case the
  // Anthropic Proxy is already a no-op for tracing, so we skip the wrap
  // rather than fabricate a context with missing required fields.
  // R5: the ordinal's frequency seed — used in two places below: persisted into
  // content_json (writer-only, for the cross-run exclude set) AND surfaced as
  // named per-ordinal trace metadata (`seedWord`/`seedRank`) so seeded vs
  // unseeded `generate` cohorts are queryable (R5.7). `seedRank` is the lemma's
  // dictionary rank, looked up from the bundled frequency file (omitted when
  // the lemma is not a surface key). Only cloze/translation cells carry seeds.
  const seedWord = opts.spec.seedWords?.[opts.ordinal] ?? null;
  const seedRank =
    seedWord !== null
      ? loadFrequency(opts.cell.language).lookup(seedWord)?.rank
      : undefined;

  const parentCtx = getCurrentLlmTraceContext();
  const body = async (): Promise<DraftOutcome> => {
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

    // Deterministic Turkish gate runs after the LLM routing decision and can
    // only downgrade it (wrong-harmony → rejected; non-word-stem → flagged).
    // Pass-through for non-TR / non-cloze / non-suffixal blanks (R3).
    const decision = applyDeterministicChecks(
      routeValidationResult(result),
      currentDraft.contentJson,
      opts.cell.language,
    );

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
        // Fold the retry's usage and bump extraProduced UNCONDITIONALLY —
        // the wasted call cost is attributable to this ordinal whether or
        // not Claude returned a parseable draft (R5.1, R5.2).
        extraUsage = addUsage(extraUsage, retry.usage);
        extraProduced += 1;
        if (!retry.ok) {
          // Parser failure on a dedup-retry. If this was the LAST allowed
          // retry slot (attempt + 1 === MAX_DEDUP_RETRIES, equivalent to
          // the design's `attempt >= MAX_DEDUP_RETRIES` after dispatch),
          // short-circuit with parserFailedAtFinal so `runOneCell` can
          // bump CellResult.parserFailedCount. Otherwise, continue — the
          // next iteration revalidates the old (rejected) currentDraft
          // and dispatches a fresh retry from this same branch.
          if (attempt + 1 >= MAX_DEDUP_RETRIES) {
            return {
              terminalStatus: 'rejected',
              parserFailedAtFinal: true,
              rejectionReasons: [PARSER_FAILURE_REASON],
              extraUsage,
              extraProduced,
              validatedCount,
            };
          }
          continue;
        }
        currentDraft = retry.draft;
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
            // `decision.flaggedReasons` is non-empty here: the rejected branch
            // is only entered on a low-quality / context-spoils / cultural
            // veto (or a deterministic-harmony downgrade), each of which
            // pushes at least one reason in `routeValidationResult` /
            // `applyDeterministicChecks`.
            rejectionReasons: decision.flaggedReasons,
            extraUsage,
            extraProduced,
            validatedCount,
          };
    }

    // ---- Auto-approved or flagged branch — attempt INSERT ---------------
    // R5.3/R5.7: persist the ordinal's frequency seed (hoisted above) as a
    // writer-only field alongside `_dedupKey` — same pattern (invisible to
    // runtime consumers, which discriminate on `type`). `fetchPriorSeeds`
    // (task 15) reads it back via `content_json->>'seedWord'` to build the
    // cross-run "already anchored" exclude set.
    const dedupKey = canonicalSurface(currentDraft.contentJson);
    const contentWithKey = {
      ...currentDraft.contentJson,
      _dedupKey: dedupKey,
      ...(seedWord ? { seedWord } : {}),
    };

    // R6 per-word cap: for vocab_recall, refuse to insert an (N+1)-th exercise
    // for an already-saturated word. Treated as a collision (empty `inserted`)
    // so the shared dedup-retry path below regenerates with a different word;
    // if every retry stays at cap, the ordinal ends `dedup-given-up` (existing
    // accounting). The `_dedupKey` unique index would NOT catch this — the
    // `word::cue` key differs per cue — so the count is the only guard.
    const capReached =
      opts.cell.exerciseType === ExerciseType.VOCAB_RECALL &&
      currentDraft.contentJson.type === ExerciseType.VOCAB_RECALL &&
      (await countApprovedForWord(
        opts.db,
        opts.cell,
        currentDraft.contentJson.expectedWord,
      )) >= VOCAB_MAX_PER_WORD;

    const inserted = capReached
      ? []
      : await opts.db
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
              decision.flaggedReasons.length > 0
                ? decision.flaggedReasons
                : null,
            coverageTags: applicableCoverageTags(opts.cell, result.coverage),
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

    // INSERT was a no-op: dedup-index conflict on _dedupKey within the cell,
    // OR the R6 per-word cap was reached (skipped INSERT). Either way the slot
    // is exhausted for this draft — regenerate with a bumped seed.
    firstAttemptDeduped = true;
    if (attempt < MAX_DEDUP_RETRIES) {
      const retry = await runRetryGeneration(
        opts.client,
        opts.spec,
        attempt + 1,
        opts.signal,
      );
      // Fold the retry's usage and bump extraProduced UNCONDITIONALLY —
      // the wasted call cost is attributable to this ordinal whether or
      // not Claude returned a parseable draft (R5.1, R5.2).
      extraUsage = addUsage(extraUsage, retry.usage);
      extraProduced += 1;
      if (!retry.ok) {
        // Parser failure on the dedup retry. If this was the last allowed
        // retry slot, short-circuit with parserFailedAtFinal; otherwise,
        // continue to the next iteration where the OLD currentDraft will
        // be revalidated (the validator's same approve/flag decision and
        // INSERT will dedup again, then we'll dispatch another retry).
        if (attempt + 1 >= MAX_DEDUP_RETRIES) {
          return {
            terminalStatus: 'rejected',
            parserFailedAtFinal: true,
            rejectionReasons: [PARSER_FAILURE_REASON],
            extraUsage,
            extraProduced,
            validatedCount,
          };
        }
        continue;
      }
      currentDraft = retry.draft;
    }
  }

  // All attempts collided with the dedup index without a successful INSERT.
  return {
    terminalStatus: 'dedup-given-up',
    extraUsage,
    extraProduced,
    validatedCount,
  };
  };

  return parentCtx
    ? withLlmTrace(
        {
          ...parentCtx,
          exerciseId: opts.draft.id,
          ...(seedWord !== null ? { seedWord } : {}),
          ...(seedRank !== undefined ? { seedRank } : {}),
        },
        body,
      )
    : body();
}
