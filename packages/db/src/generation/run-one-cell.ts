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
  ZERO_USAGE,
  addUsage,
  estimateCostUsd,
  type ClaudeUsageBreakdown,
  type GenerationSpec,
} from '@language-drill/ai';
import {
  ExerciseType,
  type CoverageAxis,
  type CoverageOutcome,
  type CoverageSpec,
  type CoverageTarget,
  type CoverageTags,
  type LearningLanguage,
} from '@language-drill/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Db } from '../client';
import { CURRICULUM_VERSION_BY_LANGUAGE } from '../curriculum';
import { assertValidCellKey } from '../lib/cell-key';
import { deterministicUuid } from '../lib/deterministic-uuid';
import {
  exercises,
  generationJobs,
  skillTopics,
} from '../schema/index';

import type { Cell } from './cells';
import { runGeneratorPool } from './generator-pool';
import { runOutcomePool } from './outcome-pool';
import { pickSeeds } from './seed-picker';
import { VOCAB_MAX_PER_WORD } from './validate-and-insert';
import { runValidatorPool } from './validator-pool';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

/**
 * Maximum in-flight `validateAndInsertWithRetry` calls per cell. Mirrors
 * MAX_VALIDATOR_CONCURRENCY / MAX_GENERATOR_CONCURRENCY: the three pools run
 * sequentially within a cell (generator drains, then validator drains, then
 * outcome pool starts), so peak in-flight Claude calls per cell is still 5.
 * Each `validateAndInsertWithRetry` worker has at most one Claude call
 * in-flight at a time (validator OR retry-generator, not both) inside its
 * sequential attempt loop, so peak per pool stays at `concurrency`.
 *
 * Motivation: prod data from 2026-05-16 showed a `vocab_recall` cell with
 * `dedupGivenUp=17` — 17 ordinals exhausted MAX_DEDUP_RETRIES sequentially,
 * dominating wall-clock at ~480 s. Parallelizing the outer dispatch cuts
 * the retry tail ~`concurrency`× without changing the dedup-detection
 * contract (each ordinal's internal attempt loop stays sequential).
 *
 * Setting this to 1 makes the outcome pool byte-identical to the pre-spec
 * serial loop — emergency rollback knob.
 */
const MAX_OUTCOME_CONCURRENCY = 5;

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
  /**
   * Ordinals where the dedup-retry path exhausted every retry slot on
   * parser failures (each regenerated draft landed in
   * `result.malformedDrafts` instead of `result.drafts`). Distinct from
   * `malformedDraftCount` — that one counts initial-batch parse failures
   * (a generator-prompt-malforming signal). `parserFailedCount` counts
   * ordinals where even retries couldn't recover, which is alarm-worthy
   * (`> 0.2` ratio over multiple jobs signals a stuck failure mode).
   * Already included in `rejectedCount` (these ordinals terminate with
   * `terminalStatus = 'rejected'`); surfaced separately so the structured
   * log line can split parser-failed ordinals from validator-rejected
   * ones. R5.4.
   */
  parserFailedCount: number;
  /**
   * Ordinals whose VALIDATOR returned a malformed first-validation response
   * (a `ValidationParseError` isolated to the ordinal by `runValidatorPool`,
   * R8.3). Mirrors `parserFailedCount` (which counts *generator* parse
   * failures): already included in `rejectedCount` (these ordinals terminate
   * `rejected`), surfaced separately so the structured log can split
   * validator-parse failures from genuine content vetoes. A single malformed
   * validator response costs at most one ordinal, never the whole cell.
   */
  validatorParseFailedCount: number;
  /**
   * Frequency map of validator rejection reasons across the ordinals this cell
   * discarded — `{ reason: count }`. Folds each rejected ordinal's
   * `DraftOutcome.rejectionReasons` (a genuine validation veto's
   * `flaggedReasons`, or `[PARSER_FAILURE_REASON]` for a parser-failed slot).
   * `dedup-given-up` ordinals contribute nothing (not a quality reason). A
   * single ordinal can add several reasons, so the counts sum to >= the
   * plain-rejected ordinal count. Persisted to
   * `generation_jobs.rejection_reason_counts` (NULL when empty) and surfaced in
   * the structured completion log; pairs with the already-persisted
   * `exercises.flagged_reasons` to give the full reason distribution.
   */
  rejectionReasonCounts: Record<string, number>;
  /**
   * R4.2/R4.3 — `true` when the within-run dedup circuit breaker tripped in
   * `runOutcomePool` and the cell stopped dispatching remaining ordinals. The
   * cell still closes `succeeded` with accurate counts for the ordinals it did
   * process; this flag distinguishes an early-bail from a normal completion in
   * the structured log (`summarizeResult`). Always `false` on the failed path.
   */
  earlyBailed: boolean;
  /**
   * Per-axis `{requested, approved}` tally for a coverage-targeted batch (Phase
   * 2). `null` when the cell did no coverage targeting (no `args.coverageTargets`).
   * Persisted to `generation_jobs.coverage_outcome`.
   */
  coverageOutcome: CoverageOutcome | null;
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
    /**
     * Phase 2 coverage controller: explicit per-ordinal axis targets from the
     * scheduler (length === count). `undefined` → no coverage targeting/tally
     * (CLI/admin and non-spec cells).
     */
    coverageTargets?: readonly CoverageTarget[];
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
 * Pulls the `expectedWord` values that have **reached the R6 per-word cap**
 * (`VOCAB_MAX_PER_WORD`) for a vocab_recall cell, to feed the generator's
 * "do not propose these" list. Under the `word::cue` dedup key (task 21) a
 * word can carry up to N exercises with distinct retrieval cues, so the
 * avoid-set is no longer "every word already present" — only the saturated
 * ones. Under-cap words are deliberately omitted so the generator MAY
 * re-propose them with a new cue, letting the cell fill toward
 * `N × distinctWords` rather than `1 × distinctWords` (R6.5).
 *
 * Grouped + `HAVING count(*) >= VOCAB_MAX_PER_WORD` over the same review-status
 * set the insert-time cap (`countApprovedForWord`) counts, so the avoid-set is
 * exactly the words the cap would now reject. Capped at
 * `MAX_PRIOR_POOL_SURFACES` so a runaway cell doesn't blow up the prompt size;
 * deterministic ordering keeps the system-prompt bytes stable across ordinals
 * so the cache prefix hits.
 *
 * Returns an empty array — not undefined — when no word is at cap yet, so the
 * caller can pass it through as `priorPoolSurfaces: []` and the prompt
 * renderer omits the section.
 */
export async function fetchPriorVocabRecallSurfaces(
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
    .groupBy(sql`content_json->>'expectedWord'`)
    .having(sql`count(*) >= ${VOCAB_MAX_PER_WORD}`)
    .orderBy(sql`content_json->>'expectedWord'`)
    .limit(MAX_PRIOR_POOL_SURFACES);
  return rows
    .map((r) => r.surface)
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/**
 * Pulls the frequency seeds already anchored in this cell's live pool (R5.3),
 * read from the writer-only `content_json.seedWord` field that
 * `validateAndInsertWithRetry` persisted (task 14). Scoped to the same cell +
 * review-status set as the dedup index, so the returned set is exactly the
 * lemmas a fresh batch should avoid re-proposing. Returns lemmas (deduped by
 * the caller's `Set`); empty when nothing in the cell carries a seed.
 */
async function fetchPriorSeeds(
  db: Db,
  cell: Cell,
): Promise<readonly string[]> {
  const rows = await db
    .select({ seed: sql<string>`content_json->>'seedWord'` })
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
        sql`content_json ? 'seedWord'`,
      ),
    );
  return rows
    .map((r) => r.seed)
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/**
 * Builds the per-ordinal frequency-seed list for a cell (R5.1), or `undefined`
 * for cell types that are NOT frequency-seeded. Only `cloze`/`translation`
 * cells are seeded — `vocab_recall` is constrained at the target-word level, so
 * a lexical seed would fight its own dedup. Pure (delegates to the deterministic
 * `pickSeeds`); the DB-backed `exclude` set is supplied by the caller via
 * `fetchPriorSeeds`. Exported for unit testing the seedable-type gate.
 */
export function buildSeedWords(
  cell: Cell,
  count: number,
  batchSeed: string,
  priorSeeds: ReadonlySet<string>,
): readonly (string | null)[] | undefined {
  if (
    cell.exerciseType !== ExerciseType.CLOZE &&
    cell.exerciseType !== ExerciseType.TRANSLATION
  ) {
    return undefined;
  }
  return pickSeeds({
    language: cell.language,
    cefrLevel: cell.cefrLevel,
    batchSeed,
    count,
    exclude: priorSeeds,
  });
}

/**
 * Build the per-axis `coverage_outcome` tally for a batch (Phase 2). `requested`
 * counts each draft's targeted value per axis; `approved` counts approved drafts
 * by their REALIZED value per axis (so a draft targeted at `2pl` but realized as
 * `3sg` via the escape hatch credits `3sg`, not `2pl`). Only the axes the batch
 * actually targeted (present in the first target) are tallied. Returns `null`
 * when there were no targets.
 */
export function tallyCoverageOutcome(
  spec: CoverageSpec | undefined,
  coverageTargets: readonly CoverageTarget[] | undefined,
  realizedPerApprovedOrdinal: readonly (CoverageTags | undefined)[],
): CoverageOutcome | null {
  if (!spec || !coverageTargets || coverageTargets.length === 0) return null;
  const activeAxes = Object.keys(coverageTargets[0]) as CoverageAxis[];
  if (activeAxes.length === 0) return null;
  const acc: CoverageOutcome = {};
  const bump = (axis: CoverageAxis, value: string, field: 'requested' | 'approved') => {
    const axisAcc = (acc[axis] ??= {});
    const bucket = (axisAcc[value] ??= { requested: 0, approved: 0 });
    bucket[field] += 1;
  };
  for (const target of coverageTargets) {
    for (const axis of activeAxes) {
      const v = target[axis];
      if (v) bump(axis, v, 'requested');
    }
  }
  for (const realized of realizedPerApprovedOrdinal) {
    if (!realized) continue;
    for (const axis of activeAxes) {
      const v = realized[axis];
      if (v) bump(axis, v, 'approved');
    }
  }
  return Object.keys(acc).length > 0 ? acc : null;
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

  // Open the audit row in 'running' state. `curriculumVersion` records the
  // on-disk `CURRICULUM_VERSION_<LANG>` constant for the cell's language so
  // the scheduler can detect a curriculum edit on the next tick and clear
  // any low-yield / saturated-dedup suppression that was based on a stale
  // curriculum revision. `Cell.language` is a `LearningLanguage` by
  // construction (cells only exist for ES/DE/TR curricula), so the lookup
  // is total.
  await db.insert(generationJobs).values({
    id: jobId,
    cellKey: cell.cellKey,
    requestedCount: args.count,
    status: 'running',
    trigger,
    curriculumVersion: CURRICULUM_VERSION_BY_LANGUAGE[cell.language as LearningLanguage],
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
  let parserFailedCount = 0;
  let validatorParseFailedCount = 0;
  // R4.2 — set from the outcome pool's circuit breaker; surfaced on the result
  // + structured log. Declared in the outer scope so it survives to the
  // success return below.
  let earlyBailed = false;
  const rejectionReasonCounts: Record<string, number> = {};
  // Phase 2 per-axis tally: collect the realized coverage of each APPROVED
  // ordinal, then build the outcome once at the end via `tallyCoverageOutcome`.
  const coverageTargets = args.coverageTargets;
  const approvedRealized: (CoverageTags | undefined)[] = [];
  const creditApproved = (realized: CoverageTags | undefined): void => {
    if (!coverageTargets) return;
    approvedRealized.push(realized);
  };
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

    // R5: anchor each cloze/translation ordinal on a distinct frequency-band
    // word, excluding seeds already used in this cell's pool (cross-run dedup).
    // `buildSeedWords` returns `undefined` for vocab_recall, leaving it
    // unseeded. Fetching priors only for seedable types avoids a needless query
    // on vocab cells.
    const isSeedableType =
      cell.exerciseType === ExerciseType.CLOZE ||
      cell.exerciseType === ExerciseType.TRANSLATION;
    const priorSeeds = isSeedableType ? await fetchPriorSeeds(db, cell) : [];
    const seedWords = buildSeedWords(
      cell,
      args.count,
      args.batchSeed,
      new Set(priorSeeds),
    );

    spec = {
      language: cell.language,
      cefrLevel: cell.cefrLevel,
      exerciseType: cell.exerciseType,
      grammarPoint: cell.grammarPoint,
      topicDomain: args.topicDomain,
      count: args.count,
      batchSeed: args.batchSeed,
      priorPoolSurfaces,
      seedWords,
      coverageTargets: args.coverageTargets,
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

    // Phase B — parallel outcome resolution. The pool dispatches one
    // `validateAndInsertWithRetry` call per ordinal up to N at a time. Each
    // worker's internal attempt loop stays sequential (dedup-detection
    // contract). Errors propagate via `Promise.all` rejection → the outer
    // try/catch routes into `failClosed`. Counters are accumulated in the
    // post-walk below, in ordinal order, so the final values are
    // deterministic across serial and parallel runs.
    const poolResult = await runOutcomePool({
      db,
      client,
      spec,
      drafts: batch.drafts,
      cell,
      args,
      generatedAt,
      firstValidations,
      signal,
      concurrency: MAX_OUTCOME_CONCURRENCY,
    });
    const outcomes = poolResult.results;
    // R4.2/R4.3 — record whether the dedup circuit breaker tripped. The counts
    // accumulated below still reflect exactly the ordinals that resolved, so the
    // audit row closes `succeeded` with accurate numbers (R4.3).
    earlyBailed = poolResult.earlyBailed;

    for (let ordinal = 0; ordinal < batch.drafts.length; ordinal++) {
      const outcome = outcomes.get(ordinal);
      if (!outcome) continue;

      combinedUsage = addUsage(combinedUsage, outcome.extraUsage);
      producedCount += outcome.extraProduced;
      validatedCount += outcome.validatedCount;
      if (outcome.parserFailedAtFinal) {
        parserFailedCount += 1;
      }
      if (outcome.validatorParseFailedAtFirst) {
        validatorParseFailedCount += 1;
      }

      switch (outcome.terminalStatus) {
        case 'inserted-approved':
          approvedCount += 1;
          insertedCount += 1;
          creditApproved(outcome.realizedCoverage);
          break;
        case 'inserted-flagged':
          flaggedCount += 1;
          insertedCount += 1;
          break;
        case 'rejected':
          rejectedCount += 1;
          // Fold this discarded ordinal's reasons into the per-cell frequency
          // map, keyed on the bounded `code` only (never the free-form
          // `detail`), so the map's cardinality stays bounded by the enum.
          // Always set for a 'rejected' terminal (validator veto reasons, or
          // [PARSER_FAILURE_REASON]); the `?? []` is a defensive no-op.
          for (const reason of outcome.rejectionReasons ?? []) {
            rejectionReasonCounts[reason.code] =
              (rejectionReasonCounts[reason.code] ?? 0) + 1;
          }
          break;
        case 'first-attempt-dedup-then-success':
          firstAttemptSkippedCount += 1;
          insertedCount += 1;
          if (outcome.terminalReviewStatus === 'auto-approved') {
            approvedCount += 1;
            creditApproved(outcome.realizedCoverage);
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
      parserFailedCount,
      validatorParseFailedCount,
    });
  }

  const coverageOutcome = tallyCoverageOutcome(
    cell.grammarPoint.coverageSpec,
    coverageTargets,
    approvedRealized,
  );

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
      // NULL (not `{}`) when the cell rejected nothing, so the column reads as
      // "no rejections" rather than an empty object on inspection.
      rejectionReasonCounts:
        Object.keys(rejectionReasonCounts).length > 0 ? rejectionReasonCounts : null,
      coverageOutcome,
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
    parserFailedCount,
    validatorParseFailedCount,
    rejectionReasonCounts,
    earlyBailed,
    coverageOutcome,
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
  /** Threaded through from the outer scope so the count survives the fail path. */
  parserFailedCount?: number;
  /** Threaded through from the outer scope so the count survives the fail path. */
  validatorParseFailedCount?: number;
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
    parserFailedCount: opts.parserFailedCount ?? 0,
    validatorParseFailedCount: opts.validatorParseFailedCount ?? 0,
    rejectionReasonCounts: {},
    // A failed cell never early-bailed — the bail is a success-path concept.
    earlyBailed: false,
    // A failed batch records no coverage tally.
    coverageOutcome: null,
  };
}
