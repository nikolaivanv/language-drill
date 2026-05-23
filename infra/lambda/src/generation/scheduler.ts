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
import type { LearningLanguage } from '@language-drill/shared';
import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { inArray, sql } from 'drizzle-orm';

import type { GenerationJobMessage } from './job-message';
import { decideEnqueue, type RecentJob } from './scheduler-decision';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCHEDULER_PER_CELL_COST_CAP_USD = 0.5;
const SLOW_QUERY_WARNING_MS = 30_000;
/** SQS `SendMessageBatch` hard limit. */
const MAX_BATCH_SIZE = 10;

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
// loadMostRecentSucceededJobPerCell
// ---------------------------------------------------------------------------

/**
 * Read the most recent succeeded `generation_jobs` row for each `cell_key`.
 *
 * `DISTINCT ON` collapses retries (same cell, multiple succeeded jobs across
 * days) to the one with the latest `started_at`. The `generation_jobs_cell_idx`
 * index `(cell_key, started_at desc)` makes this a single bounded scan even
 * with thousands of historical rows.
 *
 * Returned map is keyed by `cell_key`; cells with no succeeded job are
 * absent (the caller treats `undefined` lookups as `null`).
 */
async function loadMostRecentSucceededJobPerCell(
  db: Db,
): Promise<Map<string, RecentJob>> {
  const result = await db.execute(sql`
    SELECT DISTINCT ON (cell_key)
           cell_key, approved_count, requested_count, dedup_given_up_count,
           curriculum_version, finished_at
    FROM generation_jobs
    WHERE status = 'succeeded'
    ORDER BY cell_key, started_at DESC
  `);

  type Row = {
    cell_key: string;
    approved_count: number;
    requested_count: number;
    dedup_given_up_count: number;
    curriculum_version: string | null;
    finished_at: Date | string;
  };

  const rows = result.rows as unknown as Row[];
  const map = new Map<string, RecentJob>();
  for (const row of rows) {
    map.set(row.cell_key, {
      approvedCount: row.approved_count,
      requestedCount: row.requested_count,
      dedupGivenUpCount: row.dedup_given_up_count,
      curriculumVersion: row.curriculum_version,
      finishedAt:
        row.finished_at instanceof Date
          ? row.finished_at
          : new Date(row.finished_at),
    });
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
    const approvedInPool = approvedByCell.get(cell.cellKey) ?? 0;
    const recentJob = recentJobByCell.get(cell.cellKey) ?? null;
    const curriculumVersionOnDisk =
      CURRICULUM_VERSION_BY_LANGUAGE[cell.language as LearningLanguage];
    const decision = decideEnqueue(
      cell,
      approvedInPool,
      recentJob,
      curriculumVersionOnDisk,
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
  const messages: GenerationJobMessage[] = undersized.map(({ cell, need }) => ({
    jobId: deterministicUuid([cell.cellKey, batchSeed].join('|')),
    trigger: 'scheduled',
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
  }));

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
