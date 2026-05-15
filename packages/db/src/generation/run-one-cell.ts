/**
 * Per-cell orchestration core: opens an audit row, runs `generateBatch`, runs
 * the validator + router + dedup retry per draft, closes the audit row.
 * Cell-isolated try/catch — a single bad cell never halts the run.
 *
 * Phase 4 lifted this verbatim from `packages/db/scripts/generate-exercises.ts`
 * (Phase 3 lines 156-344, 353-525, 538-574) so both the CLI script and the
 * generation Lambda call into byte-identical orchestration. The four
 * caller-shape changes vs Phase 3 (per design Component 1):
 *
 *   1. `runOneCell` takes a `RunOneCellInput` object with caller-supplied
 *      `jobId` and `trigger` (Phase 3 generated the jobId internally and
 *      hard-coded `trigger='cli'`).
 *   2. The `args` object narrows from `ParsedArgs` to a 4-field struct — only
 *      `count`, `batchSeed`, `topicDomain`, `maxCostUsd` are used here.
 *   3. The Phase 3 module-level `aborted` flag is replaced by an optional
 *      `signal: AbortSignal` parameter the caller threads in. The CLI bridges
 *      its SIGINT handler to an `AbortController`; the Lambda passes
 *      `undefined`. The error message stays byte-identical (`Aborted by user
 *      (SIGINT)`) so existing test matchers keep passing.
 *   4. `randomUUID` is no longer imported here — the caller supplies `jobId`.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  GENERATION_MODEL,
  ZERO_USAGE,
  addUsage,
  canonicalSurface,
  estimateCostUsd,
  generateBatch,
  validateDraft,
  type ClaudeUsageBreakdown,
  type ExerciseDraft,
  type GenerationSpec,
  type ValidateDraftResult,
  type ValidationResult,
} from '@language-drill/ai';
import { ExerciseType } from '@language-drill/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Db } from '../client';
import { assertValidCellKey } from '../lib/cell-key';
import { deterministicUuid } from '../lib/deterministic-uuid';
import {
  exerciseTags,
  exercises,
  generationJobs,
  skillTopics,
} from '../schema/index';

import type { Cell } from './cells';
import { runGeneratorPool } from './generator-pool';
import { routeValidationResult } from './routing';
import { runValidatorPool } from './validator-pool';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DEDUP_RETRIES = 3;

/**
 * Bound on how many existing `expectedWord` values get pulled from the pool
 * and fed back into the generator's system prompt as a "do not propose these"
 * list. Matches `MAX_PRIOR_POOL_SURFACES_IN_PROMPT` over in
 * `packages/ai/src/generation-prompts.ts` (the prompt-side cap), so the DB
 * never returns more rows than the prompt would render. 250 covers every
 * vocab umbrella's plausible inventory at our CEFR-A1–B2 round-1 scope while
 * keeping the prompt under ~2.5 kB of bullets.
 */
const MAX_PRIOR_POOL_SURFACES = 250;

/**
 * Cap on concurrent `validateDraft` calls per cell. Tuned against:
 * (a) Anthropic Sonnet 4.6 org-tier RPM — at Lambda reservedConcurrency=3
 *     and this cap=5, we top out at ~15 in-flight validator calls across
 *     all cells, comfortably under the org-tier ceiling.
 * (b) Setting this to 1 makes runOneCell byte-identical to the pre-spec
 *     serial loop — useful as an emergency rollback knob.
 * See docs/tech-debt.md "Per-draft validation loop" entry for the broader
 * context (generation loop is still serial; spec covers validator only).
 */
const MAX_VALIDATOR_CONCURRENCY = 5;

/**
 * Maximum in-flight `generateOneDraft` calls per cell. Mirrors
 * MAX_VALIDATOR_CONCURRENCY: the two pools run sequentially within a cell
 * (generator pool drains, then validator pool starts), so peak in-flight per
 * cell is still 5 Claude calls. Setting this to 1 makes generation
 * byte-identical to the pre-spec serial loop — emergency rollback knob.
 */
const MAX_GENERATOR_CONCURRENCY = 5;

/** generation_jobs.error_message column truncates at 1000 chars. */
const ERROR_MESSAGE_MAX_LENGTH = 1000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CellResult = {
  cell: Cell;
  jobId: string;
  status: 'succeeded' | 'failed' | 'skipped-cost-cap';
  /** Rows that survived dedup AND validation. */
  insertedCount: number;
  /** Drafts whose first INSERT collided with the dedup index (per-ordinal granularity). */
  skippedCount: number;
  /** Generator + validator + retries combined. */
  tokenUsage: ClaudeUsageBreakdown;
  costUsd: number;
  errorMessage?: string;
  durationMs: number;
  inBatchDuplicateCount: number;
  /** Every draft that hit the validator (incl. retries). */
  validatedCount: number;
  /** 'flagged' rows inserted. */
  flaggedCount: number;
  /** Routed-rejected + retry-given-up. */
  rejectedCount: number;
  /** Ordinals where all 3 retries collided or all rejected. */
  dedupGivenUpCount: number;
  /**
   * Ordinals where Claude returned a payload that failed parse/validation in
   * `generateBatch`. Per-ordinal failures don't abort the cell anymore — the
   * count here surfaces them for operational visibility. A cell only fails-
   * closed on this dimension when *every* ordinal is malformed.
   */
  malformedDraftCount: number;
};

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

/**
 * Phase 4 caller-shape: `runOneCell` accepts a single options object with
 * caller-supplied identity + a narrow args struct + an optional abort signal.
 */
export type RunOneCellInput = {
  db: Db;
  client: Anthropic;
  cell: Cell;
  args: {
    count: number;
    batchSeed: string;
    topicDomain: string | null;
    maxCostUsd: number;
  };
  /** Caller-supplied audit-row id. CLI: `randomUUID()`. Scheduler: `deterministicUuid([cellKey, batchSeed].join('|'))`. */
  jobId: string;
  /** Matches the `generation_jobs.trigger` TS-enforced union. */
  trigger: 'cli' | 'scheduled' | 'admin';
  /**
   * Optional cooperative-cancellation signal. The CLI bridges its SIGINT
   * handler; the Lambda bridges its soft-deadline (Lambda remaining time
   * minus a buffer) so audit rows finalize as `failed` instead of leaking
   * as zombie `running` rows when AWS hard-kills the process.
   */
  signal?: AbortSignal;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Pulls existing `expectedWord` values from the pool for a vocab_recall cell
 * so the generator can be told what's already covered. Filtered to the same
 * rows that `exercises_dedup_idx` covers — anything that would cause an
 * `ON CONFLICT DO NOTHING` no-op at insert time. Capped at
 * `MAX_PRIOR_POOL_SURFACES` so a runaway cell doesn't blow up the prompt
 * size; deterministic ordering keeps the system-prompt bytes stable across
 * ordinals so the cache prefix hits.
 *
 * Returns an empty array — not undefined — when the cell is currently empty,
 * so the caller can pass it through as `priorPoolSurfaces: []` and the
 * prompt renderer omits the section.
 */
async function fetchPriorVocabRecallSurfaces(
  db: Db,
  cell: Cell,
): Promise<readonly string[]> {
  const rows = await db
    .select({
      surface: sql<string>`content_json->>'expectedWord'`,
    })
    .from(exercises)
    .where(
      and(
        eq(exercises.language, cell.language),
        eq(exercises.difficulty, cell.cefrLevel),
        eq(exercises.type, cell.exerciseType),
        eq(exercises.grammarPointKey, cell.grammarPoint.key),
        inArray(exercises.reviewStatus, [
          'auto-approved',
          'manual-approved',
          'flagged',
        ]),
        sql`content_json ? 'expectedWord'`,
      ),
    )
    .orderBy(sql`content_json->>'expectedWord'`)
    .limit(MAX_PRIOR_POOL_SURFACES);
  return rows
    .map((r) => r.surface)
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
}

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

type ValidateAndInsertOpts = {
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

// ---------------------------------------------------------------------------
// runOneCell
// ---------------------------------------------------------------------------

export async function runOneCell(input: RunOneCellInput): Promise<CellResult> {
  const { db, client, cell, args, jobId, trigger, signal } = input;
  const startedAt = Date.now();

  // Defense-in-depth — `resolveCells` constructs the key from typed inputs and
  // already calls this; an exception here means the cell-builder drifted from
  // the regex.
  assertValidCellKey(cell.cellKey);

  // Skill-topic precheck. Required so the audit-row INSERT below can carry an
  // `exerciseId → skillTopicId` tag without the FK constraint failing later.
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
    trigger,
  });

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
  let malformedDraftCount = 0;
  const generatedAt = new Date();

  // Built inside the try so any failure in the priors query routes through
  // failClosed (audit row already exists in 'running' state at this point).
  let spec: GenerationSpec;

  try {
    if (signal?.aborted) throw new Error('Aborted by user (SIGINT)');

    // Pull the existing vocab inventory for this cell so the generator can
    // avoid re-proposing words that `exercises_dedup_idx` would reject on
    // insert. Limited to vocab_recall because cloze/translation have an
    // effectively unbounded surface space — listing all prior sentences
    // would bloat the prompt without payback.
    const priorPoolSurfaces =
      cell.exerciseType === ExerciseType.VOCAB_RECALL
        ? await fetchPriorVocabRecallSurfaces(db, cell)
        : undefined;

    spec = {
      language: cell.language,
      cefrLevel: cell.cefrLevel,
      exerciseType: cell.exerciseType,
      grammarPoint: cell.grammarPoint,
      topicDomain: args.topicDomain,
      count: args.count,
      batchSeed: args.batchSeed,
      priorPoolSurfaces,
    };

    const batch = await runGeneratorPool({
      client,
      spec,
      count: args.count,
      signal,
      concurrency: MAX_GENERATOR_CONCURRENCY,
    });
    // Window between the generator pool resolving and the per-draft loop —
    // if SIGINT/soft-deadline arrived during the last in-flight Claude call,
    // abort here so partial drafts never land.
    if (signal?.aborted) {
      throw new Error('Aborted by user (SIGINT)');
    }
    combinedUsage = addUsage(combinedUsage, batch.tokenUsage);
    producedCount += batch.drafts.length;
    inBatchDuplicateCount = batch.drafts.filter(
      (d) => d.metadata.inBatchDuplicate,
    ).length;
    malformedDraftCount = batch.malformedDrafts.length;

    // All ordinals malformed → the cell genuinely has nothing to insert.
    // Fail-closed with a summary that includes the first malformed message
    // so CloudWatch carries the actionable detail.
    if (batch.drafts.length === 0 && malformedDraftCount > 0) {
      const first = batch.malformedDrafts[0]?.errorMessage ?? '(no detail)';
      throw new Error(
        `All ${malformedDraftCount} drafts malformed; first: ${first}`,
      );
    }

    // Phase A — parallel first-validation. The pool throws on the first
    // failure (network, 429, SIGINT); the outer try/catch routes that into
    // the existing failClosed path. Dedup-retry iterations inside
    // validateAndInsertWithRetry stay sequential and call validateDraft live.
    const firstValidations = await runValidatorPool({
      drafts: batch.drafts,
      client,
      spec,
      signal,
      concurrency: MAX_VALIDATOR_CONCURRENCY,
    });

    for (let ordinal = 0; ordinal < batch.drafts.length; ordinal++) {
      const draft = batch.drafts[ordinal];
      if (signal?.aborted) throw new Error('Aborted by user (SIGINT)');

      const outcome = await validateAndInsertWithRetry({
        db,
        client,
        spec,
        draft,
        ordinal,
        cell,
        args,
        generatedAt,
        signal,
        precomputedFirstValidation: firstValidations.get(ordinal),
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
      malformedDraftCount,
    });
  }

  const costUsd = estimateCostUsd(combinedUsage);
  const totalInputTokens =
    combinedUsage.inputTokens +
    combinedUsage.cacheCreationInputTokens +
    combinedUsage.cacheReadInputTokens;

  // Close the audit row as 'succeeded'. Counts reflect Phase 3 outcomes.
  // `dedupGivenUpCount` is persisted alongside `rejectedCount` (which already
  // includes it per the CLI's breakdown contract) so the admin approval-rate
  // metric can back it out — see `infra/lambda/src/routes/admin.ts`.
  await db
    .update(generationJobs)
    .set({
      status: 'succeeded',
      finishedAt: new Date(),
      producedCount,
      approvedCount,
      flaggedCount,
      rejectedCount,
      dedupGivenUpCount,
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
    malformedDraftCount,
  };
}

// ---------------------------------------------------------------------------
// failClosed — failure path shared by precheck + generateBatch failures.
// ---------------------------------------------------------------------------

async function failClosed(opts: {
  cell: Cell;
  jobId: string;
  tokenUsage: ClaudeUsageBreakdown;
  durationMs: number;
  errorMessage: string;
  auditRowExists: boolean;
  db: Db;
  /** Threaded through from the outer scope so the count survives the fail path. */
  malformedDraftCount?: number;
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
    malformedDraftCount: opts.malformedDraftCount ?? 0,
  };
}
