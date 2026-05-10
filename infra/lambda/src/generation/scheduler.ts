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
  buildCellKeyFromRow,
  chunk,
  createDb,
  deterministicUuid,
  enumerateCurriculumCells,
  exercises,
  requireEnv,
  ROUND_1_CEFR_LEVELS,
  type Cell,
} from '@language-drill/db';
import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { inArray, sql } from 'drizzle-orm';

import type { GenerationJobMessage } from './job-message';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_PER_CELL = 25;
const TARGET_PER_CELL = 50;
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

  // 4. Identify under-target cells. Round-1 narrowing (Req 4.5) skips C1/C2
  //    curriculum entries silently — the consumer Lambda's guard (Req 2.7) is
  //    defense-in-depth on top of this filter.
  const undersized: Array<{ cell: Cell; need: number }> = [];
  for (const cell of allCells) {
    if (!(ROUND_1_CEFR_LEVELS as readonly string[]).includes(cell.cefrLevel)) {
      continue;
    }
    const current = approvedByCell.get(cell.cellKey) ?? 0;
    if (current < MIN_PER_CELL) {
      undersized.push({ cell, need: TARGET_PER_CELL - current });
    }
  }

  // 5. Empty-curriculum-slice fast path (Req 4.9): nothing under target →
  //    don't even open an SQS connection.
  if (undersized.length === 0) {
    log({
      level: 'info',
      durationMs: Date.now() - startedAt,
      message: 'Pool at target — no jobs enqueued',
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
    durationMs: Date.now() - startedAt,
    message: 'scheduler complete',
  });
}
