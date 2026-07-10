/**
 * EventBridge-invoked scheduler Lambda for the generation pipeline. AWS fires
 * this on a cron schedule (default 04:00 UTC) with no useful event payload.
 * The handler enumerates every curriculum cell in-memory, runs a single SQL
 * aggregate over `exercises` (filtered to the same predicate as the partial
 * `exercises_pool_lookup_idx` so the scan is index-only), and computes the
 * under-target diff in JS — no SQL JOIN, because the curriculum lives in TS
 * modules, not in a DB table. For every cell whose approved count is below
 * `MIN_PER_CELL`, the handler builds a `GenerationJobMessage` with
 * `trigger='scheduled'` and posts it to the `GenerationQueue` via
 * `SendMessageBatchCommand` (≤ 10 messages per batch — SQS's hard limit).
 *
 * Idempotency across same-day re-fires: `jobId = deterministicUuid(cellKey |
 * batchSeed)` and `batchSeed = scheduled-${YYYY-MM-DD-UTC}`, so two scheduler
 * runs on the same UTC day produce identical jobIds. Phase 3's audit-row
 * `INSERT … ON CONFLICT DO NOTHING` plus the consumer Lambda's idempotency
 * guard (Req 2.9) make a redelivered message a silent no-op.
 *
 * Module-level db + SQS client are constructed at cold-start and reused across
 * invocations — same pattern as `handler.ts`.
 */

import {
  ALL_CURRICULA,
  CURRICULUM_VERSION_BY_LANGUAGE,
  buildCellKeyFromRow,
  chunk,
  createDb,
  deterministicUuid,
  enumerateCurriculumCells,
  exercises,
  requireEnv,
  type Cell,
  type Db,
} from '@language-drill/db';
import {
  COVERAGE_AXIS_VALUES,
  ExerciseType,
  type CoverageAxis,
  type LearningLanguage,
} from '@language-drill/shared';
import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { inArray, sql } from 'drizzle-orm';

import type { GenerationJobMessage } from './job-message';
import { resolveCellTarget } from './cell-targets';
import { decideCoverageTargets } from './coverage-decision';
import { loadMostRecentSucceededJobPerCell } from './recent-jobs';
import { decideEnqueue } from './scheduler-decision';
import { loadVocabTargetCoveragePerUmbrella } from './vocab-target-coverage';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCHEDULER_PER_CELL_COST_CAP_USD = 0.5;
const SLOW_QUERY_WARNING_MS = 30_000;
/** SQS `SendMessageBatch` hard limit. */
const MAX_BATCH_SIZE = 10;

/**
 * Run-level ceiling: the maximum number of under-target cells one scheduler
 * tick enqueues. Overridable via `SCHEDULER_MAX_CELLS_PER_RUN` (positive int).
 *
 * This is the brake the 2026-07-07 incident lacked — a curriculum bump fanned
 * out 187 cells in one run and spent ~$117 with no runtime stop. Capping the
 * fan-out bounds a single night's Anthropic spend (~cap × recent avg cost/cell);
 * deferred cells are still under-target next night, so they re-enqueue with no
 * persistence needed — an initial fill self-spreads over ceil(total / cap)
 * nights. See docs/tech-debt.md "No brake or alert on Anthropic API spend".
 */
const DEFAULT_MAX_CELLS_PER_RUN = 60;

/**
 * Resolve the run-level cell cap from the environment, falling back to
 * `DEFAULT_MAX_CELLS_PER_RUN`. A non-numeric, zero, or negative value is ignored
 * (uses the default) so a fat-fingered env var can never *disable* the brake.
 */
function resolveMaxCellsPerRun(): number {
  const raw = process.env['SCHEDULER_MAX_CELLS_PER_RUN'];
  if (raw === undefined) return DEFAULT_MAX_CELLS_PER_RUN;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_CELLS_PER_RUN;
}

// ---------------------------------------------------------------------------
// Cold-start singletons
// ---------------------------------------------------------------------------

const db = createDb(requireEnv('DATABASE_URL'));
const sqs = new SQSClient({ region: requireEnv('AWS_REGION') });

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}


// ---------------------------------------------------------------------------
// loadApprovedCoverageCountsPerCell
// ---------------------------------------------------------------------------

/**
 * Phase 2: approved-pool coverage distribution per cell, for the coverage
 * controller. Unnests ALL axes via LATERAL so a single query feeds every
 * axis in any cell's coverageSpec. Keyed by `cell_key` →
 * { axis → { value: count } }.
 */
async function loadApprovedCoverageCountsPerCell(
  db: Db,
): Promise<Map<string, Partial<Record<CoverageAxis, Partial<Record<string, number>>>>>> {
  const result = await db.execute(sql`
    SELECT language, difficulty, type, grammar_point_key AS grammar_point_key,
           tag.key   AS axis,
           tag.value AS value,
           COUNT(*)::int AS n
    FROM exercises
    CROSS JOIN LATERAL jsonb_each_text(coverage_tags) AS tag
    WHERE review_status IN ('auto-approved', 'manual-approved')
      AND coverage_tags IS NOT NULL
    GROUP BY language, difficulty, type, grammar_point_key, tag.key, tag.value
  `);

  type Row = {
    language: string;
    difficulty: string;
    type: string;
    grammar_point_key: string;
    axis: string;
    value: string;
    n: number;
  };
  const rows = result.rows as unknown as Row[];
  const validAxes = new Set(Object.keys(COVERAGE_AXIS_VALUES));
  const map = new Map<string, Partial<Record<CoverageAxis, Partial<Record<string, number>>>>>();
  for (const row of rows) {
    if (!validAxes.has(row.axis)) continue;
    const key = buildCellKeyFromRow({
      language: row.language,
      difficulty: row.difficulty,
      type: row.type,
      grammarPointKey: row.grammar_point_key,
    });
    const cellAxes = map.get(key) ?? {};
    const axisMap = cellAxes[row.axis as CoverageAxis] ?? {};
    axisMap[row.value] = row.n;
    cellAxes[row.axis as CoverageAxis] = axisMap;
    map.set(key, cellAxes);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(): Promise<void> {
  const startedAt = Date.now();
  const queueUrl = requireEnv('GENERATION_QUEUE_URL');
  // UTC ISO-8601 YYYY-MM-DD (Req 4.4) — drives the deterministic jobId so
  // same-day re-fires collapse on the audit-row idempotency check.
  const todayUtc = new Date().toISOString().slice(0, 10);
  const batchSeed = `scheduled-${todayUtc}`;

  log({ level: 'info', batchSeed, message: 'scheduler started' });

  // 1. Enumerate every curriculum cell (vocab umbrellas × vocab_recall;
  //    grammar points × cloze | translation). Pure, in-memory.
  const allCells: Cell[] = enumerateCurriculumCells(ALL_CURRICULA);

  // 2. Single SQL aggregate over `exercises`. The WHERE predicate matches
  //    `exercises_pool_lookup_idx`'s partial-index predicate (Req 4.6) so the
  //    scan is index-only.
  const queryStartedAt = Date.now();
  const counts = await db
    .select({
      language: exercises.language,
      difficulty: exercises.difficulty,
      type: exercises.type,
      grammarPointKey: exercises.grammarPointKey,
      approved: sql<number>`COUNT(*)::int`,
    })
    .from(exercises)
    .where(inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']))
    .groupBy(
      exercises.language,
      exercises.difficulty,
      exercises.type,
      exercises.grammarPointKey,
    );
  const queryDurationMs = Date.now() - queryStartedAt;
  if (queryDurationMs > SLOW_QUERY_WARNING_MS) {
    log({
      level: 'warn',
      durationMs: queryDurationMs,
      message: `enumeration query exceeded ${SLOW_QUERY_WARNING_MS}ms warning threshold`,
    });
  }

  // 3. Build approved-by-cell map for O(1) lookup during the in-memory diff.
  //    `buildCellKeyFromRow` coerces NULL columns to '?' which intentionally
  //    fails CELL_KEY_REGEX, so any malformed seed row simply misses the
  //    lookup (and the canonical cell still gets enqueued).
  const approvedByCell = new Map<string, number>();
  for (const row of counts) {
    approvedByCell.set(buildCellKeyFromRow(row), row.approved);
  }

  // 4. Second SQL aggregate: most recent succeeded job per cell. Drives the
  //    R6 suppression checks (saturated-dedup + low-yield + curriculum-
  //    version-mismatch-clears-suppression). Uses `generation_jobs_cell_idx`.
  const recentJobByCell = await loadMostRecentSucceededJobPerCell(db);

  // 4b. Phase 2 coverage controller: approved-pool coverage distribution per
  //     cell (all axes via LATERAL unnest). Feeds `decideCoverageTargets` for
  //     cells that have a `coverageSpec`.
  const approvedCoverageByCell = await loadApprovedCoverageCountsPerCell(db);

  // 4c. Spec 2: per-umbrella vocab_target coverage (approved-target count +
  //     distinct-covered count). Drives coverage-aware need for vocab_recall
  //     cells whose umbrella has approved targets, so curated-word coverage
  //     converges to 100% then the cell stops.
  const vocabCoverageByUmbrella = await loadVocabTargetCoveragePerUmbrella(db);

  // 5. Decide per cell. `decideEnqueue` is pure — see scheduler-decision.ts
  //    for the precedence rules. Aggregate counters per skip reason so the
  //    final summary log surfaces the imbalance.
  const undersized: Array<{ cell: Cell; need: number }> = [];
  const suppressed = {
    targetReached: 0,
    lowYield: 0,
    saturatedDedup: 0,
    c2: 0,
  };
  for (const cell of allCells) {
    const vocabCoverage =
      cell.exerciseType === ExerciseType.VOCAB_RECALL
        ? vocabCoverageByUmbrella.get(`${cell.language}|${cell.grammarPoint.key}`)
        : undefined;
    const usingTargets = vocabCoverage !== undefined && vocabCoverage.approvedTargets > 0;
    // Coverage-aware for seeded vocab umbrellas: measure progress as distinct
    // covered targets vs total approved targets, so decideEnqueue yields
    // need = |uncovered targets| and skip-target-reached fires when all covered.
    const approvedInPool = usingTargets
      ? vocabCoverage!.coveredTargets
      : (approvedByCell.get(cell.cellKey) ?? 0);
    const recentJob = recentJobByCell.get(cell.cellKey) ?? null;
    const curriculumVersionOnDisk =
      CURRICULUM_VERSION_BY_LANGUAGE[cell.language as LearningLanguage];
    // R3: per-cell target (override → table → TARGET_PER_CELL) instead of the
    // flat global, so narrow A1/A2 cells stop grinding an unreachable 50.
    const target = usingTargets ? vocabCoverage!.approvedTargets : resolveCellTarget(cell);
    const decision = decideEnqueue(
      cell,
      approvedInPool,
      target,
      recentJob,
      curriculumVersionOnDisk,
      usingTargets,
    );
    switch (decision.kind) {
      case 'enqueue':
        undersized.push({ cell, need: decision.need });
        break;
      case 'skip-c2':
        suppressed.c2 += 1;
        // C2/C1 cells are filtered silently — no per-cell log line (would
        // flood CloudWatch with hundreds of identical entries every tick).
        break;
      case 'skip-target-reached':
        suppressed.targetReached += 1;
        // Same rationale as skip-c2: the common-case skip stays silent.
        break;
      case 'skip-low-yield':
        suppressed.lowYield += 1;
        log({
          level: 'info',
          cellKey: cell.cellKey,
          reason: 'saturated-low-yield',
          message: 'cell suppressed: low-yield',
        });
        break;
      case 'skip-saturated-dedup':
        suppressed.saturatedDedup += 1;
        log({
          level: 'info',
          cellKey: cell.cellKey,
          reason: 'saturated-dedup',
          message: 'cell suppressed: saturated-dedup',
        });
        break;
    }
  }

  // 5b. Run-level ceiling: cap how many under-target cells this tick enqueues
  //     so one nightly fan-out can't spend an unbounded amount against the
  //     Anthropic account. Sort by `need` descending (emptiest cells fill
  //     first) with a deterministic `cellKey` tie-break, then keep the first
  //     `cap`. Deferred cells stay under-target and re-enqueue on a later run —
  //     no persistence, an initial fill self-spreads over ceil(total/cap)
  //     nights. Applied on `undersized` BEFORE the coverage-targets map below
  //     so it composes with the Phase-2 coverage controller.
  const cap = resolveMaxCellsPerRun();
  if (undersized.length > cap) {
    undersized.sort(
      (a, b) => b.need - a.need || a.cell.cellKey.localeCompare(b.cell.cellKey),
    );
    const deferredCount = undersized.length - cap;
    undersized.length = cap;
    log({
      level: 'info',
      cap,
      enqueuedThisRun: cap,
      deferredCount,
      message: 'run-level cell cap applied — deferring cells to a later run',
    });
  }

  // 6. Empty-curriculum-slice fast path (Req 4.9): nothing to enqueue →
  //    don't even open an SQS connection. Suppression summary still emitted
  //    so the operator can see *why* nothing was enqueued.
  if (undersized.length === 0) {
    log({
      level: 'info',
      enqueued: 0,
      suppressed,
      durationMs: Date.now() - startedAt,
      message: 'Pool at target or fully suppressed — no jobs enqueued',
    });
    return;
  }

  // 6. Build messages. `jobId = deterministicUuid(cellKey | batchSeed)` makes
  //    same-day re-fires produce identical IDs (Req 4.4 + Req 4.3.4).
  const messages: GenerationJobMessage[] = undersized.map(({ cell, need }) => {
    const base = {
      jobId: deterministicUuid([cell.cellKey, batchSeed].join('|')),
      trigger: 'scheduled' as const,
      spec: {
        language: cell.language,
        cefrLevel: cell.cefrLevel,
        exerciseType: cell.exerciseType,
        grammarPointKey: cell.grammarPoint.key,
        topicDomain: null,
        count: need,
        batchSeed,
      },
      maxCostUsd: SCHEDULER_PER_CELL_COST_CAP_USD,
    };

    // Phase 2 coverage controller — any axis the cell's coverageSpec controls.
    const spec = cell.grammarPoint.coverageSpec;
    if (!spec) return base;

    const recentJob = recentJobByCell.get(cell.cellKey) ?? null;
    const curriculumVersionOnDisk =
      CURRICULUM_VERSION_BY_LANGUAGE[cell.language as LearningLanguage];
    // Give-up clears on a curriculum bump: only feed the recent outcome when its
    // version still matches on-disk (same gate as decideEnqueue's suppression).
    const recentOutcome =
      recentJob && recentJob.curriculumVersion === curriculumVersionOnDisk
        ? (recentJob.coverageOutcome ?? null)
        : null;

    const { coverageTargets, suppressed } = decideCoverageTargets({
      spec,
      need,
      approvedByAxis: approvedCoverageByCell.get(cell.cellKey) ?? {},
      recentOutcome,
    });

    if (Object.keys(suppressed).length > 0) {
      log({
        level: 'info',
        cellKey: cell.cellKey,
        suppressed,
        message: 'coverage controller: buckets given up',
      });
    }

    if (coverageTargets.length === 0) return base; // nothing targetable

    return { ...base, spec: { ...base.spec, coverageTargets } };
  });

  // 7. Post in batches of ≤ 10 (SQS hard limit). Aggregated jobIds per batch
  //    in the structured log line per Req 4.3.5.
  for (const batch of chunk(messages, MAX_BATCH_SIZE)) {
    await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((msg, i) => ({
          Id: String(i),
          MessageBody: JSON.stringify(msg),
        })),
      }),
    );
    log({
      level: 'info',
      batchSize: batch.length,
      jobIds: batch.map((m) => m.jobId),
      message: 'SendMessageBatch sent',
    });
  }

  log({
    level: 'info',
    enqueued: messages.length,
    suppressed,
    durationMs: Date.now() - startedAt,
    message: 'scheduler complete',
  });
}
