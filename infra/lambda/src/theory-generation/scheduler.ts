/**
 * EventBridge-cron-triggered scheduler for the theory generation pipeline.
 * Once a week (Monday 04:00 UTC by default — see
 * `infra/lib/constructs/theory-scheduler-lambda.ts`), AWS invokes this
 * Lambda with no useful event payload. The handler walks the curriculum,
 * diffs against `theory_topics` (filtered to approved review statuses), and
 * posts one `TheoryGenerationJobMessage` per cell missing an approved row to
 * the theory generation queue.
 *
 * Theory differs from the exercise scheduler in two ways:
 *   - Cells are 0-or-1 (one approved row max per cell), so the diff is a
 *     `Set<string>` lookup, not a `Map<string, number>` threshold.
 *   - Cadence is weekly, not daily — theory cells fill once and stay
 *     (Req 7.6). Daily firing produces 6 no-op runs out of 7.
 *
 * Deterministic `jobId` via `deterministicUuid([cellKey, batchSeed].join('|'))`
 * makes same-week re-fires collapse to no-ops at the consumer Lambda's
 * `checkTheoryAuditRowState` guard (Req 3.5).
 */

import {
  ALL_CURRICULA,
  chunk,
  createDb,
  deterministicUuid,
  enumerateTheoryCells,
  requireEnv,
  theoryTopics,
  THEORY_ROUND_1_CEFR_LEVELS,
  type TheoryCell,
} from '@language-drill/db';
import {
  SendMessageBatchCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { inArray } from 'drizzle-orm';

import type { TheoryGenerationJobMessage } from './job-message';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Half the exercise scheduler's $0.50 cap. Theory averages ~$0.07/cell at
 * Sonnet 4.5 list pricing (docs/theory-generation-plan.md §5); $0.25 leaves
 * comfortable headroom while keeping a runaway prompt bounded.
 */
const SCHEDULER_PER_CELL_COST_CAP_USD = 0.25;

/** Telemetry-only threshold; not a hard budget. */
const SLOW_QUERY_WARNING_MS = 30_000;

/** SQS hard limit on `SendMessageBatchCommand.Entries`. */
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
  const queueUrl = requireEnv('THEORY_GENERATION_QUEUE_URL');
  const todayUtc = new Date().toISOString().slice(0, 10);
  const batchSeed = `theory-scheduled-${todayUtc}`;

  log({
    level: 'info',
    batchSeed,
    message: 'theory scheduler started',
  });

  // Vocab umbrellas are filtered upstream by `enumerateTheoryCells`.
  const allCells = enumerateTheoryCells(ALL_CURRICULA);

  // Aggregate read against `theory_topics`. The partial unique index
  // `theory_topics_pool_lookup_idx` is predicated on
  // `review_status IN ('auto-approved','manual-approved')`, so this scan is
  // index-only. Theory cells are 0-or-1 (one approved row max per cell), so
  // we don't GROUP BY — set membership is enough (Task 12's diff).
  const queryStartedAt = Date.now();
  const approved = await db
    .select({
      language: theoryTopics.language,
      grammarPointKey: theoryTopics.grammarPointKey,
    })
    .from(theoryTopics)
    .where(
      inArray(theoryTopics.reviewStatus, ['auto-approved', 'manual-approved']),
    );
  const queryDurationMs = Date.now() - queryStartedAt;

  if (queryDurationMs > SLOW_QUERY_WARNING_MS) {
    log({
      level: 'warn',
      durationMs: queryDurationMs,
      message: `enumeration query exceeded ${SLOW_QUERY_WARNING_MS}ms warning threshold`,
    });
  }

  // Build the approved-set from the aggregate read. Theory cells are 0-or-1,
  // so set-membership (not threshold comparison) is the right diff.
  const approvedSet = new Set<string>();
  for (const row of approved) {
    approvedSet.add(`${row.language}|${row.grammarPointKey}`);
  }

  // Diff: every grammar cell at a round-1 CEFR level that isn't already
  // approved gets enqueued. C1/C2 cells are silently filtered (Req 3.4).
  const undersized: TheoryCell[] = [];
  for (const cell of allCells) {
    if (
      !(THEORY_ROUND_1_CEFR_LEVELS as readonly string[]).includes(
        cell.cefrLevel,
      )
    ) {
      continue;
    }
    const lookup = `${cell.language}|${cell.grammarPoint.key}`;
    if (!approvedSet.has(lookup)) {
      undersized.push(cell);
    }
  }

  // Empty-slice fast path (Req 3.7) — no SQS connection opened.
  if (undersized.length === 0) {
    log({
      level: 'info',
      durationMs: Date.now() - startedAt,
      message: 'Pool at target — no jobs enqueued',
    });
    return;
  }

  // Deterministic jobId — same-week re-fires from EventBridge produce
  // identical jobIds; the consumer's `checkTheoryAuditRowState` collapses
  // them (Req 3.5).
  const messages: TheoryGenerationJobMessage[] = undersized.map((cell) => ({
    jobId: deterministicUuid([cell.cellKey, batchSeed].join('|')),
    trigger: 'scheduled',
    spec: {
      language: cell.language,
      cefrLevel: cell.cefrLevel,
      grammarPointKey: cell.grammarPoint.key,
      batchSeed,
    },
    maxCostUsd: SCHEDULER_PER_CELL_COST_CAP_USD,
  }));

  // Post in batches of ≤ MAX_BATCH_SIZE (SQS hard limit).
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
    message: 'theory scheduler complete',
  });
}
